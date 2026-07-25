import { clamp01, percentile } from './stats.js';

export const NORMALIZATION_MODES = Object.freeze(['v7-peak', 'fast-slow-envelope', 'robust-percentile', 'off']);

export class LevelNormalizer {
  constructor(mode = 'fast-slow-envelope') { this.configure(mode); }

  configure(mode) {
    this.mode = NORMALIZATION_MODES.includes(mode) ? mode : 'fast-slow-envelope';
    this.reset();
  }

  reset() {
    this.peaks = { low: 1e-4, mid: 1e-4, high: 1e-4, overall: 1e-4 };
    this.fast = { low: 0, mid: 0, high: 0, overall: 0 };
    this.slow = { low: 1e-4, mid: 1e-4, high: 1e-4, overall: 1e-4 };
    this.history = { low: [], mid: [], high: [], overall: [] };
  }

  process(levels) {
    const raw = { low: levels.low, mid: levels.mid, high: levels.high, overall: levels.overall };
    const normalized = {};
    for (const name of Object.keys(raw)) {
      const value = Math.max(0, raw[name] || 0);
      if (this.mode === 'off') {
        normalized[name] = clamp01(value);
      } else if (this.mode === 'v7-peak') {
        this.peaks[name] = Math.max(value, this.peaks[name] * 0.999);
        normalized[name] = clamp01(value / Math.max(1e-4, this.peaks[name] * 0.8));
      } else if (this.mode === 'fast-slow-envelope') {
        const fastCoefficient = value > this.fast[name] ? 0.55 : 0.12;
        const slowCoefficient = value > this.slow[name] ? 0.018 : 0.003;
        this.fast[name] += (value - this.fast[name]) * fastCoefficient;
        this.slow[name] += (value - this.slow[name]) * slowCoefficient;
        const floor = Math.max(0.0008, this.slow[name] * 0.08);
        const ceiling = Math.max(floor * 4, this.slow[name] * 2.8, this.fast[name] * 0.82);
        normalized[name] = value <= floor ? 0 : clamp01(Math.pow((value - floor) / (ceiling - floor), 0.72));
      } else {
        const history = this.history[name];
        history.push(value);
        if (history.length > 240) history.shift();
        const floor = Math.max(0.0008, percentile(history, 0.15));
        const ceiling = Math.max(floor * 4, percentile(history, 0.9));
        normalized[name] = value <= floor ? 0 : clamp01((value - floor) / (ceiling - floor));
      }
    }
    return { bass: normalized.low, mid: normalized.mid, treble: normalized.high, vol: normalized.overall, raw };
  }
}
