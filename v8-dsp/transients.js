import { clamp01 } from './stats.js';

export const CLASSIFIER_MODES = Object.freeze(['centroid', 'band-dominance', 'probabilistic', 'simultaneous']);

export class TransientInterpreter {
  constructor(mode = 'band-dominance') { this.configure(mode); }

  configure(mode) {
    this.mode = CLASSIFIER_MODES.includes(mode) ? mode : 'band-dominance';
    this.reset();
  }

  reset() { this.lastEvent = { low: -Infinity, mid: -Infinity, high: -Infinity }; }

  process(frame) {
    const probability = {
      low: clamp01((frame.decisions.low.score - 0.7) / 1.8),
      mid: clamp01((frame.decisions.mid.score - 0.7) / 1.8),
      high: clamp01((frame.decisions.high.score - 0.7) / 1.8),
      global: clamp01((frame.decisions.global.score - 0.7) / 1.8)
    };
    const events = [];
    const add = (band, strength) => events.push({
      band,
      class: band === 'low' ? 'lowTransient' : band === 'high' ? 'highTransient' : 'midTransient',
      sample: frame.eventSample,
      timeSec: frame.eventSample / frame.sampleRate,
      detectedAtSec: frame.timeSec,
      score: Math.min(100, Math.max(0, strength))
    });

    if (this.mode === 'centroid') {
      if (frame.decisions.global.triggered) add(frame.centroidHz < 1800 && frame.bands.low > 0.001 ? 'low' : 'high', frame.decisions.global.score);
    } else if (this.mode === 'band-dominance') {
      const candidates = ['low', 'mid', 'high'].filter((band) => frame.decisions[band].triggered);
      if (!candidates.length && frame.decisions.global.triggered) candidates.push(frame.onset.low >= frame.onset.high ? 'low' : 'high');
      if (candidates.length) {
        const band = candidates.sort((a, b) => frame.decisions[b].score - frame.decisions[a].score)[0];
        add(band, frame.decisions[band].score || frame.decisions.global.score);
      }
    } else if (this.mode === 'probabilistic') {
      if (probability.low >= 0.35) add('low', probability.low);
      if (probability.high >= 0.35) add('high', probability.high);
      if (probability.mid >= 0.45) add('mid', probability.mid);
    } else {
      for (const band of ['low', 'mid', 'high']) {
        const simultaneousCandidate = frame.decisions.global.triggered && frame.decisions[band].score > 1 && frame.bands[band] > 0.00025;
        if (frame.decisions[band].triggered || simultaneousCandidate) add(band, frame.decisions[band].score);
      }
      if (!events.length && frame.decisions.global.triggered) add(frame.onset.low >= frame.onset.high ? 'low' : 'high', frame.decisions.global.score);
    }
    return { events, probability };
  }
}
