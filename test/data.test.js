import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSyntheticFixtures } from '../eval/synthetic/generator.js';
import { generateSplits, assertNoPartitionOverlap } from '../eval/datasets/splits.js';
import { parseOnsetAnnotations } from '../eval/datasets/annotations.js';

test('synthetic generation is deterministic and covers required sample rates and cases', () => {
  const first = generateSyntheticFixtures();
  const second = generateSyntheticFixtures();
  assert.deepEqual(first.map((fixture) => [fixture.id, fixture.checksum, fixture.annotations]), second.map((fixture) => [fixture.id, fixture.checksum, fixture.annotations]));
  assert.deepEqual([...new Set(first.map((fixture) => fixture.sampleRate))], [44100, 48000]);
  const names = new Set(first.map((fixture) => fixture.id.split('/')[1]));
  for (const expected of ['isolated-impulses', 'low-frequency-bursts', 'high-frequency-noise-bursts', 'alternating-low-high', 'simultaneous-low-high', 'close-double-events', 'regular-impulse-train', 'tempo-ramp', 'silence-to-signal', 'abrupt-loud-to-quiet', 'steady-tone-no-onset', 'bass-like-non-drum', 'bright-non-percussive', 'clipping', 'additive-noise', 'reverberant-tails']) assert.ok(names.has(expected));
});

test('split generation is deterministic, group-safe, and non-overlapping', () => {
  const records = Array.from({ length: 40 }, (_, index) => ({ id: `clip-${index}`, groupId: `session-${Math.floor(index / 2)}`, tags: [] }));
  const first = generateSplits(records);
  const second = generateSplits([...records].reverse());
  assert.deepEqual(first, second);
  assert.equal(assertNoPartitionOverlap(first), true);
  for (let index = 0; index < records.length; index += 2) {
    const locations = Object.values(first.partitions).filter((ids) => ids.includes(records[index].id) || ids.includes(records[index + 1].id));
    assert.equal(locations.length, 1);
    assert.ok(locations[0].includes(records[index].id) && locations[0].includes(records[index + 1].id));
  }
  assert.ok(first.partitions.development.length > 0);
  assert.ok(first.partitions.validation.length > 0);
  assert.ok(first.partitions.privateHoldout.length > 0);
});

test('annotation parser accepts common delimiters, comments, and preserves unclassified onsets', () => {
  const parsed = parseOnsetAnnotations('# header\n0.100 kick\n0.250,snare\n0.333 unknown\n', { sampleRate: 48000 });
  assert.deepEqual(parsed.map((event) => event.class), ['lowTransient', 'highTransient', 'unclassifiedTransient']);
  assert.equal(parsed[0].sample, 4800);
  assert.equal(parsed[2].timeSec, Math.round(0.333 * 48000) / 48000);
  assert.throws(() => parseOnsetAnnotations('bad kick', { sampleRate: 48000 }), /Invalid annotation/);
});
