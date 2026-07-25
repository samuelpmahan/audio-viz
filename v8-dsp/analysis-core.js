import { magnitudeSpectrum, spectralCentroid } from '../eval/core/fft.js';
import { median, medianAbsoluteDeviation } from './stats.js';

export const ANALYSIS_MODES = Object.freeze(['v7', 'worklet-flux', 'worklet-multiband', 'worklet-robust']);

export const ANALYSIS_CONFIGS = Object.freeze({
  v7: Object.freeze({ windowSize: 2048, hopSize: 512 }),
  'worklet-flux': Object.freeze({ windowSize: 512, hopSize: 128 }),
  'worklet-multiband': Object.freeze({ windowSize: 1024, hopSize: 256 }),
  'worklet-robust': Object.freeze({ windowSize: 1024, hopSize: 256 })
});

function bandRms(spectrum, sampleRate, windowSize, lowHz, highHz) {
  const binWidth = sampleRate / windowSize;
  const low = Math.max(1, Math.ceil(lowHz / binWidth));
  const high = Math.min(spectrum.length, Math.floor(highHz / binWidth) + 1);
  let energy = 0;
  for (let index = low; index < high; index += 1) energy += spectrum[index] * spectrum[index];
  return Math.sqrt(energy / Math.max(1, high - low)) * 2 / windowSize;
}

function positiveFlux(current, previous, sampleRate, windowSize, lowHz = 0, highHz = Infinity, weighting = false) {
  if (!previous) return 0;
  const binWidth = sampleRate / windowSize;
  const low = Math.max(1, Math.ceil(lowHz / binWidth));
  const high = Math.min(current.length, Math.floor(highHz / binWidth) + 1);
  let positive = 0;
  let reference = 0;
  for (let index = low; index < high; index += 1) {
    const frequency = index * binWidth;
    const weight = weighting ? Math.min(1.8, Math.max(0.35, Math.sqrt(frequency / 1000))) : 1;
    positive += Math.max(0, current[index] - previous[index]) * weight;
    reference += previous[index] * weight;
  }
  return positive / Math.max(1e-9, reference);
}

class AdaptiveTrigger {
  constructor({ method = 'robust', historySize = 43, multiplier = 3.2, minimum = 0.015, refractorySec = 0.065, hysteresis = 0.65 } = {}) {
    Object.assign(this, { method, historySize, multiplier, minimum, refractorySec, hysteresis });
    this.reset();
  }

  reset() {
    this.history = [];
    this.average = 0;
    this.peakEnvelope = 0;
    this.armed = true;
    this.lastTriggerSec = -Infinity;
  }

  update(value, timeSec, level) {
    let threshold;
    if (this.method === 'v7') {
      threshold = Math.max(this.minimum, this.average * this.multiplier);
      this.average = this.average * 0.96 + value * 0.04;
    } else if (this.method === 'mean') {
      threshold = Math.max(this.minimum, this.average * this.multiplier);
      this.average = this.average * 0.92 + value * 0.08;
    } else {
      const center = median(this.history);
      const mad = medianAbsoluteDeviation(this.history, center);
      threshold = Math.max(this.minimum, center + this.multiplier * Math.max(mad, center * 0.08, 1e-5), this.peakEnvelope * 0.28);
      this.history.push(value);
      if (this.history.length > this.historySize) this.history.shift();
    }
    this.peakEnvelope = Math.max(value, this.peakEnvelope * 0.78);
    if (!this.armed && value < threshold * this.hysteresis) this.armed = true;
    const triggered = this.armed && level > 0.0015 && value > threshold && timeSec - this.lastTriggerSec >= this.refractorySec;
    if (triggered) {
      this.armed = false;
      this.lastTriggerSec = timeSec;
    }
    return { triggered, threshold, score: threshold > 0 ? value / threshold : 0 };
  }
}

export class SequentialAnalysisCore {
  constructor(config = {}) {
    this.configure(config);
  }

  configure(config = {}) {
    const mode = ANALYSIS_MODES.includes(config.analysis) ? config.analysis : 'worklet-robust';
    const defaults = ANALYSIS_CONFIGS[mode];
    this.config = Object.freeze({ analysis: mode, ...defaults, ...config });
    this.reset();
  }

  reset() {
    this.sampleRate = null;
    this.expectedSample = null;
    this.queue = new Float32Array(0);
    this.queueStartSample = 0;
    this.nextFrameEnd = null;
    this.previousSpectrum = null;
    this.previousBytes = null;
    this.smoothedBytes = null;
    const robust = this.config.analysis === 'worklet-robust';
    const multiband = this.config.analysis === 'worklet-multiband';
    const method = this.config.analysis === 'v7' ? 'v7' : robust ? 'robust' : 'mean';
    const common = { method, historySize: this.config.historySize ?? 43, multiplier: this.config.thresholdMultiplier ?? (robust ? 3.2 : multiband ? 2.35 : 2), minimum: this.config.minimumFlux ?? (this.config.analysis === 'v7' ? 0.5 : 0.012), refractorySec: this.config.refractorySec ?? (robust ? 0.14 : this.config.analysis === 'worklet-flux' ? 0.03 : 0.065) };
    this.triggers = {
      global: new AdaptiveTrigger(common),
      low: new AdaptiveTrigger({ ...common, minimum: this.config.minimumBandFlux ?? 0.018, refractorySec: this.config.lowRefractorySec ?? (robust ? 0.14 : 0.08) }),
      mid: new AdaptiveTrigger({ ...common, minimum: this.config.minimumBandFlux ?? 0.018, refractorySec: this.config.midRefractorySec ?? (robust ? 0.14 : 0.065) }),
      high: new AdaptiveTrigger({ ...common, minimum: this.config.minimumBandFlux ?? 0.018, refractorySec: this.config.highRefractorySec ?? (robust ? 0.14 : 0.055) })
    };
  }

  process(samples, metadata) {
    if (!(samples instanceof Float32Array)) throw new TypeError('samples must be a Float32Array');
    if (!Number.isFinite(metadata.sampleRate) || metadata.sampleRate <= 0) throw new Error('sampleRate must be explicit');
    if (Math.abs(metadata.contextTimeSec - metadata.frameStartSample / metadata.sampleRate) > 1e-9) throw new Error('contextTimeSec must use the audio clock');
    if (this.sampleRate === null) {
      this.sampleRate = metadata.sampleRate;
      this.expectedSample = metadata.frameStartSample;
      this.queueStartSample = metadata.frameStartSample;
      this.nextFrameEnd = metadata.frameStartSample + this.config.windowSize;
    }
    if (metadata.sampleRate !== this.sampleRate) throw new Error('sample rate changed without reset');
    if (metadata.frameStartSample !== this.expectedSample) throw new Error('non-contiguous or future block supplied');
    this.expectedSample += samples.length;
    const joined = new Float32Array(this.queue.length + samples.length);
    joined.set(this.queue);
    joined.set(samples, this.queue.length);
    this.queue = joined;
    const frames = [];
    while (this.nextFrameEnd <= this.expectedSample) {
      const start = this.nextFrameEnd - this.config.windowSize;
      const offset = start - this.queueStartSample;
      frames.push(this.analyzeWindow(this.queue.slice(offset, offset + this.config.windowSize), this.nextFrameEnd));
      this.nextFrameEnd += this.config.hopSize;
    }
    const earliestNeeded = this.nextFrameEnd - this.config.windowSize;
    const trim = Math.max(0, earliestNeeded - this.queueStartSample);
    if (trim) {
      this.queue = this.queue.slice(trim);
      this.queueStartSample += trim;
    }
    return frames;
  }

  analyzeWindow(window, frameEndSample) {
    const spectrum = magnitudeSpectrum(window);
    const rms = Math.sqrt(window.reduce((sum, value) => sum + value * value, 0) / window.length);
    const centroidHz = spectralCentroid(spectrum, this.sampleRate);
    const bands = {
      low: bandRms(spectrum, this.sampleRate, window.length, 35, this.config.lowHighHz ?? 250),
      mid: bandRms(spectrum, this.sampleRate, window.length, this.config.lowHighHz ?? 250, this.config.midHighHz ?? 2500),
      high: bandRms(spectrum, this.sampleRate, window.length, this.config.midHighHz ?? 2500, Math.min(16000, this.sampleRate / 2))
    };
    const timeSec = frameEndSample / this.sampleRate;
    let onset;
    if (this.config.analysis === 'v7') {
      if (!this.smoothedBytes) this.smoothedBytes = new Float64Array(spectrum.length);
      const bytes = new Uint8Array(spectrum.length);
      for (let index = 0; index < spectrum.length; index += 1) {
        const db = 20 * Math.log10(spectrum[index] / window.length + 1e-12);
        const raw = Math.max(0, Math.min(255, ((db + 100) / 70) * 255));
        this.smoothedBytes[index] = 0.4 * this.smoothedBytes[index] + 0.6 * raw;
        bytes[index] = Math.round(this.smoothedBytes[index]);
      }
      let flux = 0;
      if (this.previousBytes) for (let index = 0; index < bytes.length; index += 1) flux += Math.abs(bytes[index] - this.previousBytes[index]) / bytes.length;
      this.previousBytes = bytes;
      onset = { global: flux, low: flux * bands.low / Math.max(1e-9, bands.low + bands.mid + bands.high), mid: 0, high: flux * bands.high / Math.max(1e-9, bands.low + bands.mid + bands.high) };
    } else {
      const weighted = this.config.analysis === 'worklet-robust';
      onset = {
        global: positiveFlux(spectrum, this.previousSpectrum, this.sampleRate, window.length, 35, Math.min(16000, this.sampleRate / 2), weighted),
        low: positiveFlux(spectrum, this.previousSpectrum, this.sampleRate, window.length, 35, this.config.lowHighHz ?? 250),
        mid: positiveFlux(spectrum, this.previousSpectrum, this.sampleRate, window.length, this.config.lowHighHz ?? 250, this.config.midHighHz ?? 2500),
        high: positiveFlux(spectrum, this.previousSpectrum, this.sampleRate, window.length, this.config.midHighHz ?? 2500, Math.min(16000, this.sampleRate / 2), weighted)
      };
    }
    this.previousSpectrum = spectrum;
    const triggerNames = this.config.analysis === 'worklet-flux' || this.config.analysis === 'v7' ? ['global'] : ['global', 'low', 'mid', 'high'];
    const decisions = {};
    for (const name of triggerNames) decisions[name] = this.triggers[name].update(onset[name], timeSec, name === 'global' ? rms : bands[name]);
    for (const name of ['global', 'low', 'mid', 'high']) if (!decisions[name]) decisions[name] = { triggered: false, threshold: 0, score: 0 };
    if (this.config.analysis === 'worklet-robust' || this.config.analysis === 'worklet-multiband') {
      const globalNovelty = onset.global > Math.max(0.008, decisions.global.threshold * (this.config.analysis === 'worklet-robust' ? 0.6 : 0.75));
      for (const name of ['low', 'mid', 'high']) {
        const energetic = bands[name] > Math.max(0.00025, rms * 0.005);
        if (!globalNovelty || !energetic) decisions[name] = { ...decisions[name], triggered: false };
      }
    }
    const hopStart = frameEndSample - this.config.hopSize;
    let peakOffset = 0;
    let peak = 0;
    for (let index = Math.max(0, window.length - this.config.hopSize); index < window.length; index += 1) {
      if (Math.abs(window[index]) > peak) { peak = Math.abs(window[index]); peakOffset = index - (window.length - this.config.hopSize); }
    }
    return {
      sampleRate: this.sampleRate,
      frameEndSample,
      eventSample: hopStart + peakOffset,
      timeSec,
      rms,
      centroidHz,
      centroid: Math.min(1, centroidHz / (this.sampleRate / 2)),
      bands,
      onset,
      decisions
    };
  }
}
