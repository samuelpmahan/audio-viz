import { performance } from 'node:perf_hooks';
import { createDetector } from './detectors/index.js';
import { runFixture, compareEventStreams } from './runner.js';
import { scoreEvents, scoreClasses, scoreSimultaneous, summarizeFiles } from './metrics/events.js';
import { scoreLevelBehavior } from './metrics/levels.js';
import { mean, percentile } from './core/math.js';

function aggregateRuntime(results, startupTimeMs) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.runtime.mode}/${result.runtime.sampleRate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result.runtime);
  }
  const byModeAndSampleRate = {};
  for (const [key, values] of groups) {
    const blocks = values.reduce((sum, value) => sum + value.blocks, 0);
    const totalWallMs = values.reduce((sum, value) => sum + value.totalWallMs, 0);
    const audioDurationSec = values.reduce((sum, value) => sum + value.audioDurationSec, 0);
    byModeAndSampleRate[key] = {
      files: values.length,
      blocks,
      meanProcessingMsPer128Block: mean(values.map((value) => value.meanProcessingMsPer128Block)),
      p95FileBlockTimeMs: percentile(values.map((value) => value.p95ProcessingMs), 0.95),
      p99FileBlockTimeMs: percentile(values.map((value) => value.p99ProcessingMs), 0.99),
      totalWallMs,
      throughputXRealtime: audioDurationSec / Math.max(totalWallMs / 1000, 1e-12),
      lateBlocks: values.reduce((sum, value) => sum + value.lateBlocks, 0),
      droppedBlocks: values.reduce((sum, value) => sum + value.droppedBlocks, 0),
      heapGrowthBytes: values.reduce((sum, value) => sum + value.heapGrowthBytes, 0)
    };
  }
  return {
    startupTimeMs,
    byModeAndSampleRate,
    timingMetricsEnvironmentDependent: true,
    browserMeasurement: 'Node simulation of AudioWorklet-sized blocks and structured-clone output; not a claim of browser or mobile performance.'
  };
}

function subsetSummary(results, predicate) {
  const selected = results.filter(predicate);
  return selected.length ? summarizeFiles(selected) : null;
}

export async function evaluateDetector({ detectorId, fixtures, mode = 'fast', compareModes = false, config = {} }) {
  const initializeStart = performance.now();
  const { detector, descriptor } = createDetector(detectorId, config);
  const startupTimeMs = performance.now() - initializeStart;
  const modes = compareModes ? ['fast', 'browser'] : [mode];
  const results = [];
  for (const executionMode of modes) {
    for (const fixture of fixtures) results.push(await runFixture(detector, fixture, { mode: executionMode }));
  }
  const primaryResults = results.filter((result) => result.runtime.mode === modes[0]);
  const fileScores = primaryResults.map((result) => ({
    id: result.fixture.id,
    tags: result.fixture.tags,
    sampleRate: result.fixture.sampleRate,
    checksum: result.fixture.checksum,
    durationSec: result.fixture.durationSec,
    annotationCount: result.fixture.annotations.length,
    eventCount: result.events.length,
    onset25ms: scoreEvents(result.events, result.fixture.annotations, result.fixture.durationSec, 0.025),
    onset50ms: scoreEvents(result.events, result.fixture.annotations, result.fixture.durationSec, 0.05),
    classes: scoreClasses(result.events, result.fixture.annotations, 0.05),
    simultaneous: scoreSimultaneous(result.events, result.fixture.annotations, 0.05),
    levels: scoreLevelBehavior(result.frames, result.fixture),
    runtime: result.runtime
  }));
  const summary = summarizeFiles(primaryResults);
  summary.subsets = {
    isolatedDrums: subsetSummary(primaryResults, (result) => result.fixture.tags.includes('isolated')),
    fullMix: subsetSummary(primaryResults, (result) => result.fixture.tags.includes('full-mix')),
    sampleRate44100: subsetSummary(primaryResults, (result) => result.fixture.sampleRate === 44100),
    sampleRate48000: subsetSummary(primaryResults, (result) => result.fixture.sampleRate === 48000)
  };
  summary.simultaneous = fileScores.filter((file) => file.simultaneous.annotationCount > 0).map((file) => ({ id: file.id, ...file.simultaneous }));

  const equivalence = [];
  if (compareModes) {
    for (const fixture of fixtures) {
      const fast = results.find((result) => result.fixture.id === fixture.id && result.runtime.mode === 'fast');
      const browser = results.find((result) => result.fixture.id === fixture.id && result.runtime.mode === 'browser');
      equivalence.push({ id: fixture.id, ...compareEventStreams(fast, browser, 0) });
    }
  }
  return { descriptor, summary, fileScores, rawResults: results, runtime: aggregateRuntime(results, startupTimeMs), equivalence };
}
