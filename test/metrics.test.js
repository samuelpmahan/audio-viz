import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEvents, scoreEvents, scoreClasses } from '../eval/metrics/events.js';

const truth = (timeSec, eventClass = 'lowTransient') => ({ timeSec, sample: Math.round(timeSec * 48000), class: eventClass });
const prediction = (timeSec, eventClass = 'lowTransient') => ({ ...truth(timeSec, eventClass), detectedAtSec: timeSec, score: 1 });

test('event matching is one-to-one and maximizes cardinality', () => {
  const result = matchEvents([prediction(1.01), prediction(1.04)], [truth(1), truth(1.05)], 0.05);
  assert.equal(result.matches.length, 2);
  assert.equal(new Set(result.matches.map((pair) => pair.prediction._index)).size, 2);
  assert.equal(new Set(result.matches.map((pair) => pair.annotation._index)).size, 2);
});

test('tolerance boundaries are inclusive at 25 ms and reject values beyond them', () => {
  assert.equal(scoreEvents([prediction(1.025)], [truth(1)], 2, 0.025).truePositive, 1);
  assert.equal(scoreEvents([prediction(1.02501)], [truth(1)], 2, 0.025).truePositive, 0);
});

test('duplicate predictions remain false positives and are reported as duplicates', () => {
  const score = scoreEvents([prediction(1), prediction(1.005)], [truth(1)], 2, 0.05);
  assert.equal(score.truePositive, 1);
  assert.equal(score.falsePositive, 1);
  assert.equal(score.duplicateTriggers, 1);
  assert.equal(score.duplicateTriggersPerMatchedGroundTruth, 1);
});

test('timing errors report median, p95, and signed early/late bias', () => {
  const score = scoreEvents([prediction(0.99), prediction(2.02)], [truth(1), truth(2)], 3, 0.05);
  assert.ok(Math.abs(score.medianAbsoluteTimingErrorMs - 15) < 1e-9);
  assert.ok(Math.abs(score.p95AbsoluteTimingErrorMs - 19.5) < 1e-9);
  assert.ok(Math.abs(score.signedTimingBiasMs - 5) < 1e-9);
});

test('class confusion uses transient labels and calculates macro F1', () => {
  const annotations = [truth(1, 'lowTransient'), truth(2, 'highTransient')];
  const predictions = [prediction(1, 'highTransient'), prediction(2, 'highTransient')];
  const score = scoreClasses(predictions, annotations);
  assert.equal(score.confusionMatrix.lowTransient.highTransient, 1);
  assert.equal(score.confusionMatrix.highTransient.highTransient, 1);
  assert.equal(score.perClass.lowTransient.recall, 0);
  assert.ok(score.macroF1 > 0 && score.macroF1 < 0.5);
});
