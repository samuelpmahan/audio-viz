import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineDetectors, createDetector } from '../eval/detectors/index.js';
import { generateSyntheticFixtures, SYNTHETIC_MANIFEST_VERSION, SYNTHETIC_SEED } from '../eval/synthetic/generator.js';
import { evaluateDetector } from '../eval/evaluate.js';
import { writeRunArtifacts } from '../eval/artifacts.js';
import { runFixture } from '../eval/runner.js';
import { scoreEvents, scoreClasses } from '../eval/metrics/events.js';

const fixtures = generateSyntheticFixtures({ smoke: true });

test('all four fixed baselines execute in both modes with no equivalence failures', async () => {
  assert.equal(baselineDetectors.length, 4);
  for (const Detector of baselineDetectors) {
    const evaluation = await evaluateDetector({ detectorId: Detector.id, fixtures: fixtures.slice(0, 2), compareModes: true });
    assert.equal(evaluation.equivalence.filter((item) => !item.equivalent).length, 0);
    assert.equal(evaluation.descriptor.version, '1.0.0');
  }
});

test('null and adversarial controls fail for expected reasons', async () => {
  const target = generateSyntheticFixtures().filter((fixture) => fixture.sampleRate === 48000 && ['alternating-low-high', 'simultaneous-low-high'].includes(fixture.id.split('/')[1]));
  const run = async (id) => {
    const { detector } = createDetector(id);
    const results = [];
    for (const fixture of target) results.push({ fixture, ...(await runFixture(detector, fixture)) });
    return results;
  };
  const none = await run('null-none');
  assert.equal(none.reduce((sum, result) => sum + result.events.length, 0), 0);
  const fixed = await run('null-fixed-period');
  assert.ok(scoreEvents(fixed[0].events, fixed[0].fixture.annotations, fixed[0].fixture.durationSec, 0.05).f1 < 0.5);
  const low = await run('null-every-low');
  assert.equal(scoreClasses(low[0].events, low[0].fixture.annotations).perClass.highTransient.recall, 0);
  const high = await run('null-every-high');
  assert.equal(scoreClasses(high[0].events, high[0].fixture.annotations).perClass.lowTransient.recall, 0);
  const boundary = await run('null-boundaries');
  assert.ok(scoreClasses(boundary[1].events, boundary[1].fixture.annotations).macroF1 <= 0.5);
  assert.equal(scoreEvents(boundary[1].events, boundary[1].fixture.annotations, boundary[1].fixture.durationSec, 0.05).recall, 0.5);
  const duplicate = await run('null-duplicates');
  assert.ok(scoreEvents(duplicate[0].events, duplicate[0].fixture.annotations, duplicate[0].fixture.durationSec, 0.05).duplicateTriggers > 0);
});

test('run artifacts contain the complete reproducibility surface and do not overwrite', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'audio-viz-artifacts-'));
  try {
    const evaluation = await evaluateDetector({ detectorId: 'null-none', fixtures: fixtures.slice(0, 2), mode: 'fast' });
    const runConfig = { detector: evaluation.descriptor, datasetManifestVersion: SYNTHETIC_MANIFEST_VERSION, splitVersion: 'grouped-v1', seed: SYNTHETIC_SEED, command: 'test' };
    const timestamp = new Date('2026-01-17T00:00:00.000Z');
    const directory = await writeRunArtifacts({ evaluation, runConfig, outputRoot: temporary, timestamp });
    const files = await readdir(directory);
    for (const expected of ['config.json', 'environment.json', 'summary.json', 'per-file.csv', 'event-timelines.jsonl', 'timing-errors.svg', 'confusion-matrix.svg', 'runtime.json', 'failures', 'README.md']) assert.ok(files.includes(expected));
    assert.match(await readFile(join(directory, 'environment.json'), 'utf8'), /gitCommitSha/);
    await assert.rejects(writeRunArtifacts({ evaluation, runConfig, outputRoot: temporary, timestamp }), /EEXIST/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('same synthetic benchmark twice has identical non-runtime results', async () => {
  const first = await evaluateDetector({ detectorId: 'spectral-flux-baseline', fixtures, mode: 'fast' });
  const second = await evaluateDetector({ detectorId: 'spectral-flux-baseline', fixtures, mode: 'fast' });
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.rawResults.map((result) => result.events), second.rawResults.map((result) => result.events));
});
