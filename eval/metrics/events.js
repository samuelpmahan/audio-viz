import { mean, percentile } from '../core/math.js';

const CLASSES = ['lowTransient', 'highTransient'];

function better(left, right) {
  if (!right) return left;
  if (left.count !== right.count) return left.count > right.count ? left : right;
  if (left.classMatches !== right.classMatches) return left.classMatches > right.classMatches ? left : right;
  if (Math.abs(left.error - right.error) > 1e-12) return left.error < right.error ? left : right;
  return left.key <= right.key ? left : right;
}

export function matchEvents(predictions, annotations, toleranceSec) {
  const predicted = predictions.map((event, index) => ({ ...event, _index: index })).sort((a, b) => a.timeSec - b.timeSec || a._index - b._index);
  const truth = annotations.map((event, index) => ({ ...event, _index: index })).sort((a, b) => a.timeSec - b.timeSec || a.class.localeCompare(b.class) || a._index - b._index);
  const table = Array.from({ length: predicted.length + 1 }, () => Array(truth.length + 1));
  table[0][0] = { count: 0, classMatches: 0, error: 0, pairs: [], key: '' };
  for (let i = 0; i <= predicted.length; i += 1) {
    for (let j = 0; j <= truth.length; j += 1) {
      const current = table[i][j];
      if (!current) continue;
      if (i < predicted.length) table[i + 1][j] = better(current, table[i + 1][j]);
      if (j < truth.length) table[i][j + 1] = better(current, table[i][j + 1]);
      if (i < predicted.length && j < truth.length) {
        const signedErrorSec = predicted[i].timeSec - truth[j].timeSec;
        if (Math.abs(signedErrorSec) <= toleranceSec + 1e-12) {
          const pair = { prediction: predicted[i], annotation: truth[j], signedErrorSec };
          const candidate = {
            count: current.count + 1,
            classMatches: current.classMatches + Number(predicted[i].class === truth[j].class),
            error: current.error + Math.abs(signedErrorSec),
            pairs: [...current.pairs, pair],
            key: `${current.key}|${predicted[i]._index}:${truth[j]._index}`
          };
          table[i + 1][j + 1] = better(candidate, table[i + 1][j + 1]);
        }
      }
    }
  }
  const matches = table[predicted.length][truth.length].pairs;
  const predictedMatches = new Set(matches.map((pair) => pair.prediction._index));
  const truthMatches = new Set(matches.map((pair) => pair.annotation._index));
  return {
    matches,
    unmatchedPredictions: predictions.filter((_, index) => !predictedMatches.has(index)),
    unmatchedAnnotations: annotations.filter((_, index) => !truthMatches.has(index))
  };
}

export function scoreEvents(predictions, annotations, durationSec, toleranceSec) {
  const matching = matchEvents(predictions, annotations, toleranceSec);
  const truePositive = matching.matches.length;
  const falsePositive = matching.unmatchedPredictions.length;
  const falseNegative = matching.unmatchedAnnotations.length;
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  const errors = matching.matches.map((pair) => pair.signedErrorSec);
  const absoluteErrors = errors.map(Math.abs);
  const matchedTruthIndices = new Set(matching.matches.map((pair) => pair.annotation._index));
  const duplicateTriggers = matching.unmatchedPredictions.filter((prediction) =>
    annotations.some((annotation, index) => matchedTruthIndices.has(index) && Math.abs(prediction.timeSec - annotation.timeSec) <= toleranceSec)
  ).length;
  return {
    toleranceMs: toleranceSec * 1000,
    precision,
    recall,
    f1: 2 * precision * recall / Math.max(1e-12, precision + recall),
    truePositive,
    falsePositive,
    falseNegative,
    missedEvents: falseNegative,
    falsePositivesPerMinute: falsePositive / Math.max(durationSec / 60, 1e-12),
    medianAbsoluteTimingErrorMs: percentile(absoluteErrors, 0.5) * 1000,
    p95AbsoluteTimingErrorMs: percentile(absoluteErrors, 0.95) * 1000,
    signedTimingBiasMs: mean(errors) * 1000,
    duplicateTriggers,
    duplicateTriggersPerMatchedGroundTruth: duplicateTriggers / Math.max(1, truePositive),
    matching
  };
}

export function scoreClasses(predictions, annotations, toleranceSec = 0.05) {
  const labeledAnnotations = annotations.filter((event) => CLASSES.includes(event.class));
  const labeledPredictions = predictions.filter((event) => CLASSES.includes(event.class));
  const matching = matchEvents(labeledPredictions, labeledAnnotations, toleranceSec);
  const confusionMatrix = Object.fromEntries(CLASSES.map((actual) => [actual, Object.fromEntries(CLASSES.map((predicted) => [predicted, 0]))]));
  for (const pair of matching.matches) confusionMatrix[pair.annotation.class][pair.prediction.class] += 1;
  const perClass = {};
  for (const eventClass of CLASSES) {
    const truePositive = matching.matches.filter((pair) => pair.annotation.class === eventClass && pair.prediction.class === eventClass).length;
    const predictedCount = labeledPredictions.filter((event) => event.class === eventClass).length;
    const actualCount = labeledAnnotations.filter((event) => event.class === eventClass).length;
    const precision = truePositive / Math.max(1, predictedCount);
    const recall = truePositive / Math.max(1, actualCount);
    perClass[eventClass] = { precision, recall, f1: 2 * precision * recall / Math.max(1e-12, precision + recall), truePositive, predictedCount, actualCount };
  }
  return { perClass, macroF1: mean(CLASSES.map((eventClass) => perClass[eventClass].f1)), confusionMatrix };
}

export function scoreSimultaneous(predictions, annotations, toleranceSec = 0.05) {
  const simultaneousSamples = new Set();
  for (const annotation of annotations) {
    if (annotations.some((other) => other !== annotation && other.sample === annotation.sample && other.class !== annotation.class)) simultaneousSamples.add(annotation.sample);
  }
  const simultaneousTruth = annotations.filter((event) => simultaneousSamples.has(event.sample));
  if (!simultaneousTruth.length) return { annotationCount: 0, f1: null };
  const relevantPredictions = predictions.filter((prediction) => simultaneousTruth.some((truth) => Math.abs(prediction.timeSec - truth.timeSec) <= toleranceSec));
  return { annotationCount: simultaneousTruth.length, ...scoreEvents(relevantPredictions, simultaneousTruth, 1, toleranceSec) };
}

export function summarizeFiles(fileResults) {
  const predictions = [];
  const annotations = [];
  let durationSec = 0;
  for (const file of fileResults) {
    const offset = durationSec + 1;
    predictions.push(...file.events.map((event) => ({ ...event, timeSec: event.timeSec + offset })));
    annotations.push(...file.fixture.annotations.map((event) => ({ ...event, timeSec: event.timeSec + offset })));
    durationSec += file.fixture.durationSec + 1;
  }
  const scoringDuration = fileResults.reduce((sum, file) => sum + file.fixture.durationSec, 0);
  return {
    onset25ms: scoreEvents(predictions, annotations, scoringDuration, 0.025),
    onset50ms: scoreEvents(predictions, annotations, scoringDuration, 0.05),
    classes: scoreClasses(predictions, annotations, 0.05)
  };
}
