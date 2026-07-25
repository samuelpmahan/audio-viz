import { createHash } from 'node:crypto';
import { seededRandom } from '../core/math.js';

const DEFAULT_SEED = 0x41565a;

function fixtureBuilder(name, sampleRate, durationSec = 2.4, seed = DEFAULT_SEED) {
  const samples = new Float32Array(Math.ceil(durationSec * sampleRate));
  const annotations = [];
  const random = seededRandom(seed ^ sampleRate ^ [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0));
  const sampleAt = (timeSec) => Math.round(timeSec * sampleRate);
  const addAnnotation = (timeSec, eventClass) => {
    const sample = sampleAt(timeSec);
    annotations.push({ sample, timeSec: sample / sampleRate, class: eventClass });
  };
  const addImpulse = (timeSec, amplitude = 0.8) => {
    const sample = sampleAt(timeSec);
    if (sample < samples.length) samples[sample] += amplitude;
  };
  const addLow = (timeSec, amplitude = 0.7, duration = 0.16, attackSec = 0.002) => {
    const start = sampleAt(timeSec);
    const length = sampleAt(duration);
    for (let i = 0; i < length && start + i < samples.length; i += 1) {
      const time = i / sampleRate;
      const envelope = Math.min(1, time / attackSec) * Math.exp(-time / 0.055);
      samples[start + i] += amplitude * envelope * Math.sin(2 * Math.PI * 82 * time);
    }
  };
  const addHigh = (timeSec, amplitude = 0.5, duration = 0.09, attackSec = 0.001) => {
    const start = sampleAt(timeSec);
    const length = sampleAt(duration);
    let previous = 0;
    for (let i = 0; i < length && start + i < samples.length; i += 1) {
      const time = i / sampleRate;
      const noise = random() * 2 - 1;
      const highPassed = noise - previous * 0.92;
      previous = noise;
      const envelope = Math.min(1, time / attackSec) * Math.exp(-time / 0.028);
      samples[start + i] += amplitude * envelope * highPassed;
    }
  };
  const addTone = (startSec, endSec, frequency, amplitude, attackSec = 0) => {
    const start = sampleAt(startSec);
    const end = Math.min(samples.length, sampleAt(endSec));
    for (let sample = start; sample < end; sample += 1) {
      const time = (sample - start) / sampleRate;
      const envelope = attackSec ? Math.min(1, time / attackSec) : 1;
      samples[sample] += amplitude * envelope * Math.sin(2 * Math.PI * frequency * time);
    }
  };
  return { name, sampleRate, samples, annotations, random, sampleAt, addAnnotation, addImpulse, addLow, addHigh, addTone };
}

function finalize(builder, tags = [], levelTransitions = []) {
  for (let i = 0; i < builder.samples.length; i += 1) builder.samples[i] = Math.max(-1, Math.min(1, builder.samples[i]));
  builder.annotations.sort((a, b) => a.sample - b.sample || a.class.localeCompare(b.class));
  const checksum = createHash('sha256').update(Buffer.from(builder.samples.buffer)).digest('hex');
  return Object.freeze({
    id: `synthetic/${builder.name}/${builder.sampleRate}`,
    source: 'synthetic-v1',
    sampleRate: builder.sampleRate,
    samples: builder.samples,
    durationSec: builder.samples.length / builder.sampleRate,
    annotations: Object.freeze(builder.annotations),
    tags: Object.freeze(['synthetic', 'adversarial', ...tags]),
    groupId: `synthetic/${builder.name}`,
    checksum,
    levelTransitions: Object.freeze(levelTransitions)
  });
}

function makeFixtures(sampleRate, seed) {
  const fixtures = [];
  let b = fixtureBuilder('isolated-impulses', sampleRate, 2.2, seed);
  for (const time of [0.4, 1.0, 1.6]) { b.addImpulse(time); b.addAnnotation(time, 'highTransient'); }
  fixtures.push(finalize(b, ['isolated']));

  b = fixtureBuilder('low-frequency-bursts', sampleRate, 2.2, seed);
  for (const time of [0.35, 0.95, 1.55]) { b.addLow(time); b.addAnnotation(time, 'lowTransient'); }
  fixtures.push(finalize(b, ['isolated', 'low']));

  b = fixtureBuilder('high-frequency-noise-bursts', sampleRate, 2.2, seed);
  for (const time of [0.35, 0.95, 1.55]) { b.addHigh(time); b.addAnnotation(time, 'highTransient'); }
  fixtures.push(finalize(b, ['isolated', 'high']));

  b = fixtureBuilder('alternating-low-high', sampleRate, 2.4, seed);
  for (const [time, eventClass] of [[0.3, 'lowTransient'], [0.7, 'highTransient'], [1.1, 'lowTransient'], [1.5, 'highTransient'], [1.9, 'lowTransient']]) {
    eventClass === 'lowTransient' ? b.addLow(time) : b.addHigh(time);
    b.addAnnotation(time, eventClass);
  }
  fixtures.push(finalize(b, ['full-mix']));

  b = fixtureBuilder('simultaneous-low-high', sampleRate, 2.2, seed);
  for (const time of [0.45, 1.15, 1.75]) {
    b.addLow(time); b.addHigh(time); b.addAnnotation(time, 'lowTransient'); b.addAnnotation(time, 'highTransient');
  }
  fixtures.push(finalize(b, ['full-mix', 'simultaneous']));

  b = fixtureBuilder('close-double-events', sampleRate, 2.2, seed);
  for (const time of [0.5, 0.535, 1.35, 1.39]) { b.addHigh(time, 0.45, 0.025); b.addAnnotation(time, 'highTransient'); }
  fixtures.push(finalize(b, ['isolated', 'duplicates']));

  b = fixtureBuilder('regular-impulse-train', sampleRate, 2.4, seed);
  for (let time = 0.25; time < 2.2; time += 0.25) { b.addImpulse(time, 0.7); b.addAnnotation(time, 'highTransient'); }
  fixtures.push(finalize(b, ['tempo-diagnostic']));

  b = fixtureBuilder('tempo-ramp', sampleRate, 3.0, seed);
  for (let time = 0.25, interval = 0.34, index = 0; time < 2.8; time += interval, interval *= 0.92, index += 1) {
    const eventClass = index % 2 ? 'highTransient' : 'lowTransient';
    eventClass === 'lowTransient' ? b.addLow(time, 0.55) : b.addHigh(time, 0.42);
    b.addAnnotation(time, eventClass);
  }
  fixtures.push(finalize(b, ['tempo-diagnostic']));

  b = fixtureBuilder('silence-to-signal', sampleRate, 2.3, seed);
  b.addTone(0.6, 1.65, 110, 0.45); b.addAnnotation(0.6, 'lowTransient');
  fixtures.push(finalize(b, ['level'], [{ timeSec: 0.6, kind: 'attack' }, { timeSec: 1.65, kind: 'release' }]));

  b = fixtureBuilder('abrupt-loud-to-quiet', sampleRate, 2.4, seed);
  b.addTone(0.3, 1.15, 120, 0.75); b.addTone(1.15, 2.0, 120, 0.08); b.addAnnotation(0.3, 'lowTransient');
  fixtures.push(finalize(b, ['level'], [{ timeSec: 0.3, kind: 'attack' }, { timeSec: 1.15, kind: 'levelDrop' }]));

  b = fixtureBuilder('steady-tone-no-onset', sampleRate, 2.2, seed);
  b.addTone(0, 2.2, 440, 0.2);
  fixtures.push(finalize(b, ['null']));

  b = fixtureBuilder('bass-like-non-drum', sampleRate, 2.3, seed);
  for (const time of [0.4, 1.2]) { b.addTone(time, time + 0.55, 73, 0.55, 0.12); b.addAnnotation(time, 'lowTransient'); }
  fixtures.push(finalize(b, ['non-percussive', 'low']));

  b = fixtureBuilder('bright-non-percussive', sampleRate, 2.3, seed);
  for (const time of [0.4, 1.2]) { b.addTone(time, time + 0.5, 5200, 0.22, 0.1); b.addAnnotation(time, 'highTransient'); }
  fixtures.push(finalize(b, ['non-percussive', 'high']));

  b = fixtureBuilder('clipping', sampleRate, 2.2, seed);
  for (const time of [0.4, 1.0, 1.6]) { b.addLow(time, 3.5); b.addHigh(time, 2.5); b.addAnnotation(time, 'lowTransient'); b.addAnnotation(time, 'highTransient'); }
  fixtures.push(finalize(b, ['clipping', 'simultaneous']));

  b = fixtureBuilder('additive-noise', sampleRate, 2.4, seed);
  for (let i = 0; i < b.samples.length; i += 1) b.samples[i] = (b.random() * 2 - 1) * 0.045;
  for (const [time, eventClass] of [[0.45, 'lowTransient'], [1.1, 'highTransient'], [1.8, 'lowTransient']]) {
    eventClass === 'lowTransient' ? b.addLow(time, 0.5) : b.addHigh(time, 0.42);
    b.addAnnotation(time, eventClass);
  }
  fixtures.push(finalize(b, ['noise', 'full-mix']));

  b = fixtureBuilder('reverberant-tails', sampleRate, 2.5, seed);
  for (const [time, eventClass] of [[0.35, 'lowTransient'], [1.25, 'highTransient']]) {
    for (let echo = 0; echo < 7; echo += 1) {
      const echoTime = time + echo * 0.055;
      const gain = 0.65 * Math.pow(0.55, echo);
      eventClass === 'lowTransient' ? b.addLow(echoTime, gain) : b.addHigh(echoTime, gain);
    }
    b.addAnnotation(time, eventClass);
  }
  fixtures.push(finalize(b, ['reverb', 'full-mix']));
  return fixtures;
}

export function generateSyntheticFixtures({ sampleRates = [44100, 48000], seed = DEFAULT_SEED, smoke = false } = {}) {
  const fixtures = sampleRates.flatMap((sampleRate) => makeFixtures(sampleRate, seed));
  if (!smoke) return fixtures;
  const names = new Set(['alternating-low-high', 'simultaneous-low-high', 'steady-tone-no-onset', 'abrupt-loud-to-quiet']);
  return fixtures.filter((fixture) => names.has(fixture.id.split('/')[1]));
}

export const SYNTHETIC_MANIFEST_VERSION = 'synthetic-v1';
export const SYNTHETIC_SEED = DEFAULT_SEED;
