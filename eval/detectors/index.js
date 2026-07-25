import { baselineDetectors } from './baselines.js';
import { adversarialDetectors } from './adversarial.js';

const detectorTypes = [...baselineDetectors, ...adversarialDetectors];

export function detectorIds() {
  return detectorTypes.map((Detector) => Detector.id);
}

export function createDetector(id, config = {}) {
  const Detector = detectorTypes.find((candidate) => candidate.id === id);
  if (!Detector) throw new Error(`Unknown detector ${id}. Available: ${detectorIds().join(', ')}`);
  const detector = new Detector();
  detector.initialize(config);
  return { detector, descriptor: { id: Detector.id, version: Detector.version, config: detector.config } };
}

export { baselineDetectors, adversarialDetectors };
