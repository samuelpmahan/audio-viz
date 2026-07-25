import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, v8Detectors } from '../eval/detectors/index.js';
import { generateSyntheticFixtures } from '../eval/synthetic/generator.js';
import { compareEventStreams, runFixture } from '../eval/runner.js';
import { SequentialAnalysisCore } from '../v8-dsp/analysis-core.js';
import { parseConfig } from '../v8-dsp/config.js';
import { MetricsAdapter } from '../v8-dsp/metrics-adapter.js';
import { LevelNormalizer } from '../v8-dsp/normalization.js';
import { RhythmTracker } from '../v8-dsp/rhythm.js';
import { TransientInterpreter } from '../v8-dsp/transients.js';
import { circularDistance } from '../v8-dsp/stats.js';

const fixtures = generateSyntheticFixtures();
const fixture = (name, rate = 48000) => fixtures.find((candidate) => candidate.id === `synthetic/${name}/${rate}`);

test('every retained V8 detector is deterministic, causal, and block-equivalent at 44.1/48 kHz', async () => {
  assert.deepEqual(v8Detectors.map((Detector) => Detector.id), ['v8-flux-v1', 'v8-multiband-v1', 'v8-robust-v1']);
  for (const Detector of v8Detectors) {
    for (const sampleRate of [44100, 48000]) {
      const input = fixture('alternating-low-high', sampleRate);
      const { detector } = createDetector(Detector.id);
      const fast = await runFixture(detector, input, { mode: 'fast' });
      const repeated = await runFixture(detector, input, { mode: 'fast' });
      const browser = await runFixture(detector, input, { mode: 'browser' });
      assert.deepEqual(fast.events, repeated.events);
      assert.deepEqual(compareEventStreams(fast, browser), { equivalent: true, toleranceSamples: 0 });
      assert.ok(fast.events.every((event) => event.timeSec <= event.detectedAtSec && event.sample < input.samples.length));
    }
  }
});

test('V8 detectors reject silence and steady tone, handle close pairs, and expose simultaneous low/high mode', async () => {
  for (const id of v8Detectors.map((Detector) => Detector.id)) {
    const { detector } = createDetector(id);
    assert.equal((await runFixture(detector, fixture('steady-tone-no-onset'))).events.length, 0);
  }
  const { detector } = createDetector('v8-flux-v1');
  const close = await runFixture(detector, fixture('close-double-events'));
  assert.ok(close.events.length >= 3, 'low-latency flux should retain at least one close pair');
  const interpreter = new TransientInterpreter('simultaneous');
  const result = interpreter.process({
    sampleRate: 48000, eventSample: 4800, timeSec: 0.11, centroidHz: 2000,
    onset: { global: 2, low: 2, mid: 0, high: 2 }, bands: { low: 0.1, mid: 0, high: 0.1 },
    decisions: { global: { triggered: true, score: 2 }, low: { triggered: true, score: 2 }, mid: { triggered: false, score: 0 }, high: { triggered: true, score: 2 } }
  });
  assert.deepEqual(result.events.map((event) => event.class), ['lowTransient', 'highTransient']);
});

test('analysis configuration switching and reset discard history safely', () => {
  const core = new SequentialAnalysisCore({ analysis: 'worklet-flux' });
  const metadata = { sampleRate: 48000, frameStartSample: 0, contextTimeSec: 0 };
  core.process(new Float32Array(128), metadata);
  core.configure({ analysis: 'worklet-robust' });
  assert.doesNotThrow(() => core.process(new Float32Array(128), metadata));
  core.reset();
  assert.doesNotThrow(() => core.process(new Float32Array(128), metadata));
});

test('normalizers recover after a loud transient and remain finite in silence', () => {
  for (const mode of ['v7-peak', 'fast-slow-envelope', 'robust-percentile', 'off']) {
    const normalizer = new LevelNormalizer(mode);
    const first = normalizer.process({ low: 1, mid: 1, high: 1, overall: 1 });
    let recovered;
    for (let index = 0; index < 300; index += 1) recovered = normalizer.process({ low: 0.05, mid: 0.05, high: 0.05, overall: 0.05 });
    const silent = normalizer.process({ low: 0, mid: 0, high: 0, overall: 0 });
    for (const output of [first, recovered, silent]) for (const key of ['bass', 'mid', 'treble', 'vol']) assert.ok(Number.isFinite(output[key]) && output[key] >= 0 && output[key] <= 1);
    assert.equal(silent.vol, 0);
  }
});

test('phase follower gains and loses confidence without violent phase correction', () => {
  const tracker = new RhythmTracker('phase-follower');
  for (const time of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) tracker.addOnset(time, 1);
  const stable = tracker.update(3.75);
  assert.ok(stable.bpm > 115 && stable.bpm < 125);
  assert.ok(stable.confidence > 0.2);
  const before = tracker.update(3.9).beatPhase;
  tracker.addOnset(4.23, 0.5);
  const after = tracker.update(3.9).beatPhase;
  assert.ok(circularDistance(before, after) < 0.15);
  const lost = tracker.update(9);
  assert.ok(lost.confidence < stable.confidence * 0.1);
});

test('compatibility adapter always exposes the complete V7 metrics shape', () => {
  const adapter = new MetricsAdapter();
  const metrics = adapter.update({
    frame: { rms: 0.1, centroid: 0.2, onset: { global: 0, low: 0, mid: 0, high: 0 } },
    levels: { bass: 0.2, mid: 0.3, treble: 0.4, vol: 0.3 }, interpretation: { events: [], probability: { low: 0, high: 0 } },
    rhythm: { bpm: 0, onBeat: 0, beatPhase: 0, confidence: 0 }, modulation: { lfo2: 0, lfo4: 0, lfo8: 0, ramp2: 0, ramp4: 0, ramp8: 0 },
    timeSec: 1, presentationOffsetSec: 0, config: {}, processing: { meanMs: 0, p95Ms: 0 }
  });
  for (const key of ['bass', 'mid', 'treble', 'vol', 'centroid', 'isKick', 'isSnare', 'bassHit', 'midHit', 'highHit', 'bassPresence', 'midPresence', 'highPresence', 'bassTime', 'midTime', 'highTime', 'bpm', 'onBeat', 'beatPhase', 'lfo2', 'lfo4', 'lfo8', 'ramp2', 'ramp4', 'ramp8']) assert.ok(key in metrics, key);
});

test('query parameters override storage and invalid values fall back', () => {
  const parsed = parseConfig({ search: '?engine=v8&analysis=worklet-multiband&normalization=off&classifier=simultaneous&rhythm=off&latency=manual-offset&offset=75&bpm=133', stored: JSON.stringify({ analysis: 'v7' }) });
  assert.equal(parsed.analysis, 'worklet-multiband');
  assert.equal(parsed.manualOffsetMs, 75);
  assert.equal(parsed.fixedBpm, 133);
  const invalid = parseConfig({ search: '?analysis=nope&normalization=wat&offset=oops&bpm=9999' });
  assert.equal(invalid.analysis, 'worklet-robust');
  assert.equal(invalid.normalization, 'fast-slow-envelope');
  assert.equal(invalid.fixedBpm, 300);
});
