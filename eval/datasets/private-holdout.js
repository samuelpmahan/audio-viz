import { summarizeFiles } from '../metrics/events.js';

// Run this inside the holdout environment. Only aggregate metrics leave it.
export function aggregatePrivateHoldout(results) {
  const aggregate = summarizeFiles(results);
  return Object.freeze({
    filesScored: results.length,
    durationSec: results.reduce((sum, result) => sum + result.fixture.durationSec, 0),
    onset25ms: { precision: aggregate.onset25ms.precision, recall: aggregate.onset25ms.recall, f1: aggregate.onset25ms.f1 },
    onset50ms: { precision: aggregate.onset50ms.precision, recall: aggregate.onset50ms.recall, f1: aggregate.onset50ms.f1 },
    macroClassF1: aggregate.classes.macroF1
  });
}
