import { SequentialAnalysisCore } from '../../v8-dsp/analysis-core.js';
import { LevelNormalizer } from '../../v8-dsp/normalization.js';
import { TransientInterpreter } from '../../v8-dsp/transients.js';

class V8HarnessDetector {
  initialize(config = {}) {
    this.config = Object.freeze({ ...this.defaultConfig, ...config });
    this.core = new SequentialAnalysisCore(this.config);
    this.normalizer = new LevelNormalizer(this.config.normalization);
    this.interpreter = new TransientInterpreter(this.config.classifier);
  }

  reset() {
    this.core.reset();
    this.normalizer.reset();
    this.interpreter.reset();
  }

  process(samples, metadata) {
    const analyzed = this.core.process(samples, metadata);
    const frames = [];
    const events = [];
    for (const frame of analyzed) {
      const levels = this.normalizer.process({ ...frame.bands, overall: frame.rms });
      const interpretation = this.interpreter.process(frame);
      frames.push({
        sample: frame.frameEndSample,
        timeSec: frame.timeSec,
        level: frame.rms,
        normalizedLevel: levels.vol,
        diagnostics: { bands: frame.bands, onset: frame.onset, decisions: frame.decisions }
      });
      events.push(...interpretation.events.filter((event) => event.class !== 'midTransient').map((event) => ({
        sample: event.sample,
        timeSec: event.timeSec,
        detectedAtSec: event.detectedAtSec,
        class: event.class,
        score: event.score
      })));
    }
    return { frames, events };
  }
}

export class V8FluxV1 extends V8HarnessDetector {
  static id = 'v8-flux-v1';
  static version = '1.0.0';
  defaultConfig = Object.freeze({ analysis: 'worklet-flux', normalization: 'fast-slow-envelope', classifier: 'centroid', windowSize: 512, hopSize: 128, thresholdMultiplier: 2, minimumFlux: 0.012, refractorySec: 0.03 });
}

export class V8MultibandV1 extends V8HarnessDetector {
  static id = 'v8-multiband-v1';
  static version = '1.0.0';
  defaultConfig = Object.freeze({ analysis: 'worklet-multiband', normalization: 'fast-slow-envelope', classifier: 'simultaneous', windowSize: 1024, hopSize: 256, thresholdMultiplier: 2.35, minimumBandFlux: 0.018, refractorySec: 0.06 });
}

export class V8RobustV1 extends V8HarnessDetector {
  static id = 'v8-robust-v1';
  static version = '1.0.0';
  defaultConfig = Object.freeze({ analysis: 'worklet-robust', normalization: 'fast-slow-envelope', classifier: 'band-dominance', windowSize: 1024, hopSize: 256, historySize: 43, thresholdMultiplier: 3.2, minimumFlux: 0.012, minimumBandFlux: 0.018, refractorySec: 0.14, lowRefractorySec: 0.14, midRefractorySec: 0.14, highRefractorySec: 0.14 });
}

export const v8Detectors = [V8FluxV1, V8MultibandV1, V8RobustV1];
