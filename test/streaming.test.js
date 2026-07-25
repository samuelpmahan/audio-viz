import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector } from '../eval/detectors/index.js';
import { generateSyntheticFixtures } from '../eval/synthetic/generator.js';
import { runFixture, compareEventStreams } from '../eval/runner.js';

const fixtureByName = (name, sampleRate) => generateSyntheticFixtures().find((fixture) => fixture.id === `synthetic/${name}/${sampleRate}`);

test('runner exposes only exact current blocks and handles a sample on a block boundary', async () => {
  const fixture = { id: 'boundary', sampleRate: 48000, samples: new Float32Array(300), durationSec: 300 / 48000, annotations: [], tags: [], levelTransitions: [] };
  fixture.samples[128] = 1;
  const seen = [];
  const detector = {
    initialize() {}, reset() { this.expected = 0; },
    process(samples, metadata) {
      assert.equal(samples.buffer.byteLength, samples.byteLength);
      assert.equal(metadata.frameStartSample, this.expected);
      this.expected += samples.length;
      seen.push({ start: metadata.frameStartSample, length: samples.length, peak: samples.findIndex((value) => value === 1) });
      return { frames: [], events: [] };
    }
  };
  await runFixture(detector, fixture);
  assert.deepEqual(seen, [{ start: 0, length: 128, peak: -1 }, { start: 128, length: 128, peak: 0 }, { start: 256, length: 44, peak: -1 }]);
});

test('future-dated detector outputs are rejected', async () => {
  const fixture = { id: 'future', sampleRate: 48000, samples: new Float32Array(256), durationSec: 256 / 48000, annotations: [], tags: [], levelTransitions: [] };
  const detector = {
    reset() {},
    process(samples, metadata) {
      return { frames: [], events: [{ sample: metadata.frameStartSample + samples.length, timeSec: 99, detectedAtSec: 99, class: 'lowTransient', score: 1 }] };
    }
  };
  await assert.rejects(runFixture(detector, fixture), /future block/);
});

test('detector reset makes repeated files independent', async () => {
  const fixture = fixtureByName('alternating-low-high', 48000);
  const { detector } = createDetector('spectral-flux-baseline');
  const first = await runFixture(detector, fixture);
  await runFixture(detector, fixtureByName('steady-tone-no-onset', 48000));
  const second = await runFixture(detector, fixture);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.frames, second.frames);
});

test('fast and browser-realistic streams are exactly equivalent at 44.1 and 48 kHz', async () => {
  for (const sampleRate of [44100, 48000]) {
    const fixture = fixtureByName('alternating-low-high', sampleRate);
    const { detector } = createDetector('multiband-energy-baseline');
    const fast = await runFixture(detector, fixture, { mode: 'fast' });
    const browser = await runFixture(detector, fixture, { mode: 'browser' });
    assert.deepEqual(compareEventStreams(fast, browser, 0), { equivalent: true, toleranceSamples: 0 });
  }
});

test('stream metadata rejects gaps, rewinds, and sample-rate changes', () => {
  const { detector } = createDetector('spectral-flux-baseline');
  detector.process(new Float32Array(128), { sampleRate: 48000, frameStartSample: 0, contextTimeSec: 0 });
  assert.throws(() => detector.process(new Float32Array(128), { sampleRate: 48000, frameStartSample: 256, contextTimeSec: 256 / 48000 }), /non-contiguous/);
  detector.reset();
  detector.process(new Float32Array(128), { sampleRate: 44100, frameStartSample: 0, contextTimeSec: 0 });
  assert.throws(() => detector.process(new Float32Array(128), { sampleRate: 48000, frameStartSample: 128, contextTimeSec: 128 / 48000 }), /sample rate changed/);
});
