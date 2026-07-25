import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { hostname, platform, release, arch, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { stableStringify } from './core/math.js';
import { matchEvents } from './metrics/events.js';

function cleanMetric(metric) {
  if (!metric || typeof metric !== 'object') return metric;
  if (Array.isArray(metric)) return metric.map(cleanMetric);
  return Object.fromEntries(Object.entries(metric).filter(([key]) => key !== 'matching').map(([key, value]) => [key, cleanMetric(value)]));
}

function csvCell(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function timingSvg(errors) {
  const bins = [-50, -25, -10, 0, 10, 25, 50];
  const counts = bins.map((upper, index) => errors.filter((value) => value <= upper && (index === 0 || value > bins[index - 1])).length);
  const max = Math.max(...counts, 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="280" role="img" aria-label="Timing error histogram"><rect width="100%" height="100%" fill="white"/><text x="20" y="24" font-family="sans-serif" font-size="16">Signed timing error (ms)</text>${counts.map((count, index) => `<rect x="${35 + index * 90}" y="${240 - count / max * 180}" width="64" height="${count / max * 180}" fill="#4567b7"/><text x="${40 + index * 90}" y="260" font-family="sans-serif" font-size="11">≤${bins[index]}</text><text x="${58 + index * 90}" y="${232 - count / max * 180}" font-family="sans-serif" font-size="11">${count}</text>`).join('')}</svg>`;
}

function confusionSvg(matrix) {
  const labels = ['lowTransient', 'highTransient'];
  const maximum = Math.max(...labels.flatMap((actual) => labels.map((predicted) => matrix[actual]?.[predicted] ?? 0)), 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="390" role="img" aria-label="Confusion matrix"><rect width="100%" height="100%" fill="white"/><text x="20" y="25" font-family="sans-serif" font-size="16">Actual rows / predicted columns</text>${labels.map((actual, row) => labels.map((predicted, column) => { const value = matrix[actual]?.[predicted] ?? 0; const opacity = 0.15 + 0.75 * value / maximum; return `<rect x="${180 + column * 160}" y="${70 + row * 130}" width="140" height="110" fill="#365fa0" fill-opacity="${opacity}"/><text x="${245 + column * 160}" y="${132 + row * 130}" text-anchor="middle" font-family="sans-serif" font-size="22">${value}</text>`; }).join('')).join('')}${labels.map((label, index) => `<text x="${250 + index * 160}" y="55" text-anchor="middle" font-family="sans-serif" font-size="12">${label}</text><text x="170" y="${130 + index * 130}" text-anchor="end" font-family="sans-serif" font-size="12">${label}</text>`).join('')}</svg>`;
}

function gitSha() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function failureReports(evaluation) {
  const timing = [];
  const falsePositives = [];
  const misses = [];
  const duplicates = [];
  const confusions = [];
  for (const result of evaluation.rawResults.filter((item) => item.runtime.mode === evaluation.fileScores[0]?.runtime.mode)) {
    const match = matchEvents(result.events, result.fixture.annotations, 0.05);
    timing.push(...match.matches.map((pair) => ({ id: result.fixture.id, annotationSec: pair.annotation.timeSec, predictionSec: pair.prediction.timeSec, errorMs: pair.signedErrorSec * 1000, actual: pair.annotation.class, predicted: pair.prediction.class })));
    falsePositives.push(...match.unmatchedPredictions.map((event) => ({ id: result.fixture.id, timeSec: event.timeSec, class: event.class })));
    misses.push(...match.unmatchedAnnotations.map((event) => ({ id: result.fixture.id, timeSec: event.timeSec, class: event.class })));
    confusions.push(...match.matches.filter((pair) => pair.annotation.class !== pair.prediction.class).map((pair) => ({ id: result.fixture.id, timeSec: pair.annotation.timeSec, actual: pair.annotation.class, predicted: pair.prediction.class })));
    for (const prediction of match.unmatchedPredictions) {
      const near = match.matches.find((pair) => Math.abs(pair.annotation.timeSec - prediction.timeSec) <= 0.05);
      if (near) duplicates.push({ id: result.fixture.id, timeSec: prediction.timeSec, matchedAnnotationSec: near.annotation.timeSec, class: prediction.class });
    }
  }
  const sampleRateF1 = Object.fromEntries(Object.entries(evaluation.summary.subsets).filter(([key]) => key.startsWith('sampleRate')).map(([key, value]) => [key, value?.onset50ms.f1 ?? null]));
  return {
    'largest-timing-errors.json': timing.sort((a, b) => Math.abs(b.errorMs) - Math.abs(a.errorMs)).slice(0, 100),
    'false-positives.json': falsePositives.slice(0, 200),
    'missed-annotations.json': misses.slice(0, 200),
    'duplicate-triggers.json': duplicates.slice(0, 200),
    'class-confusions.json': confusions.slice(0, 200),
    'sample-rate-regressions.json': sampleRateF1,
    'slow-files.json': evaluation.fileScores.map((file) => ({ id: file.id, sampleRate: file.sampleRate, meanMs: file.runtime.meanProcessingMsPer128Block, p99Ms: file.runtime.p99ProcessingMs })).sort((a, b) => b.p99Ms - a.p99Ms).slice(0, 50)
  };
}

export async function writeRunArtifacts({ evaluation, runConfig, outputRoot = 'runs', timestamp = new Date(), privateHoldout = false }) {
  const hash = createHash('sha256').update(stableStringify(runConfig)).digest('hex').slice(0, 12);
  const stamp = timestamp.toISOString().replaceAll(':', '').replaceAll('.', '-');
  const root = resolve(outputRoot);
  await mkdir(root, { recursive: true });
  const runDirectory = join(root, `${stamp}_${evaluation.descriptor.id}_${hash}`);
  await mkdir(runDirectory, { recursive: false });
  await mkdir(join(runDirectory, 'failures'));
  const environment = {
    gitCommitSha: gitSha(),
    node: process.version,
    v8: process.versions.v8,
    operatingSystem: { platform: platform(), release: release(), arch: arch() },
    host: hostname(),
    cpu: cpus()[0]?.model ?? null,
    createdAt: timestamp.toISOString(),
    timingMetricsEnvironmentDependent: true
  };
  await writeFile(join(runDirectory, 'config.json'), `${JSON.stringify(runConfig, null, 2)}\n`);
  await writeFile(join(runDirectory, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`);
  await writeFile(join(runDirectory, 'summary.json'), `${JSON.stringify(cleanMetric(evaluation.summary), null, 2)}\n`);
  await writeFile(join(runDirectory, 'runtime.json'), `${JSON.stringify(evaluation.runtime, null, 2)}\n`);
  const columns = ['id', 'sampleRate', 'durationSec', 'checksum', 'annotationCount', 'eventCount', 'onset25ms', 'onset50ms', 'classes', 'simultaneous', 'levels', 'runtime'];
  const publicColumns = privateHoldout ? ['id', 'sampleRate', 'durationSec', 'checksum', 'runtime'] : columns;
  const rows = evaluation.fileScores.map((file) => publicColumns.map((column) => csvCell(cleanMetric(file[column]))).join(','));
  await writeFile(join(runDirectory, 'per-file.csv'), `${publicColumns.join(',')}\n${rows.join('\n')}\n`);
  const primaryMode = evaluation.fileScores[0]?.runtime.mode;
  const timelines = evaluation.rawResults.filter((result) => result.runtime.mode === primaryMode).map((result) => JSON.stringify({
    id: result.fixture.id,
    sampleRate: result.fixture.sampleRate,
    predictions: result.events,
    annotations: privateHoldout ? undefined : result.fixture.annotations
  }));
  await writeFile(join(runDirectory, 'event-timelines.jsonl'), `${timelines.join('\n')}\n`);
  const errors = evaluation.rawResults.filter((result) => result.runtime.mode === primaryMode).flatMap((result) => matchEvents(result.events, result.fixture.annotations, 0.05).matches.map((pair) => pair.signedErrorSec * 1000));
  await writeFile(join(runDirectory, 'timing-errors.svg'), timingSvg(errors));
  await writeFile(join(runDirectory, 'confusion-matrix.svg'), confusionSvg(evaluation.summary.classes.confusionMatrix));
  const failures = privateHoldout
    ? { 'redacted.json': { note: 'Accuracy failures and per-file labels are retained inside the private holdout environment.', slowFilesAvailableInRuntimeCsv: true } }
    : failureReports(evaluation);
  for (const [name, report] of Object.entries(failures)) await writeFile(join(runDirectory, 'failures', name), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(runDirectory, 'README.md'), `# Immutable audio-viz evaluation run\n\nDetector: \`${evaluation.descriptor.id}@${evaluation.descriptor.version}\`  \nConfig hash: \`${hash}\`  \nDataset manifest: \`${runConfig.datasetManifestVersion}\`  \nSplit: \`${runConfig.splitVersion}\`  \nSeed: \`${runConfig.seed}\`\n\nReplay with the command recorded in \`config.json\`. Timing values depend on the host; accuracy and event timelines are deterministic. Failure files reference local dataset IDs and timestamps and never copy audio. ${privateHoldout ? 'Per-file holdout labels are redacted.' : ''}\n`);
  // Mark files read-only as a guardrail. The unique directory and no-overwrite mkdir are authoritative.
  await Promise.all(['config.json', 'environment.json', 'summary.json', 'per-file.csv', 'event-timelines.jsonl', 'timing-errors.svg', 'confusion-matrix.svg', 'runtime.json', 'README.md'].map((name) => chmod(join(runDirectory, name), 0o444)));
  return runDirectory;
}
