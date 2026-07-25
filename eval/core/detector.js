import { magnitudeSpectrum, spectralCentroid } from './fft.js';

/**
 * @typedef {{sampleRate:number, frameStartSample:number, contextTimeSec:number}} BlockMetadata
 * @typedef {{timeSec:number, detectedAtSec:number, sample:number, class:'lowTransient'|'highTransient', score:number}} DetectorEvent
 * @typedef {{timeSec:number, sample:number, level:number, normalizedLevel?:number, diagnostics?:object}} DetectorFrame
 * @typedef {{frames:DetectorFrame[], events:DetectorEvent[], diagnostics?:object}} DetectorOutput
 */

export class WindowedDetector {
  initialize(config = {}) {
    this.config = Object.freeze({ ...this.defaultConfig, ...config });
    this.reset();
  }

  reset() {
    this.sampleRate = null;
    this.expectedSample = null;
    this.queueStartSample = 0;
    this.queue = new Float32Array(0);
    this.nextFrameEnd = null;
    this.resetState?.();
  }

  process(samples, metadata) {
    if (!(samples instanceof Float32Array)) throw new TypeError('samples must be a Float32Array');
    if (!Number.isFinite(metadata.sampleRate) || metadata.sampleRate <= 0) throw new Error('sampleRate must be explicit');
    if (Math.abs(metadata.contextTimeSec - metadata.frameStartSample / metadata.sampleRate) > 1e-9) {
      throw new Error('contextTimeSec must use the audio clock');
    }
    if (this.sampleRate === null) {
      this.sampleRate = metadata.sampleRate;
      this.expectedSample = metadata.frameStartSample;
      this.queueStartSample = metadata.frameStartSample;
      this.nextFrameEnd = metadata.frameStartSample + this.config.windowSize;
    }
    if (metadata.sampleRate !== this.sampleRate) throw new Error('sample rate changed without reset');
    if (metadata.frameStartSample !== this.expectedSample) throw new Error('non-contiguous or future block supplied');
    this.expectedSample += samples.length;

    const appended = new Float32Array(this.queue.length + samples.length);
    appended.set(this.queue);
    appended.set(samples, this.queue.length);
    this.queue = appended;
    const output = { frames: [], events: [] };

    while (this.nextFrameEnd <= this.expectedSample) {
      const windowStart = this.nextFrameEnd - this.config.windowSize;
      const offset = windowStart - this.queueStartSample;
      const window = this.queue.slice(offset, offset + this.config.windowSize);
      const hop = window.subarray(window.length - this.config.hopSize);
      const spectrum = magnitudeSpectrum(window);
      const rms = Math.sqrt(window.reduce((sum, value) => sum + value * value, 0) / window.length);
      const centroid = spectralCentroid(spectrum, this.sampleRate);
      const frame = this.analyzeFrame({
        window,
        hop,
        spectrum,
        rms,
        centroid,
        windowStartSample: windowStart,
        frameEndSample: this.nextFrameEnd,
        sampleRate: this.sampleRate
      });
      if (frame.frame) output.frames.push(frame.frame);
      if (frame.events) output.events.push(...frame.events);
      this.nextFrameEnd += this.config.hopSize;
    }

    const earliestNeeded = this.nextFrameEnd - this.config.windowSize;
    const trim = Math.max(0, earliestNeeded - this.queueStartSample);
    if (trim > 0) {
      this.queue = this.queue.slice(trim);
      this.queueStartSample += trim;
    }
    return output;
  }

  makeFrame(context, normalizedLevel, diagnostics = {}) {
    return {
      timeSec: context.frameEndSample / context.sampleRate,
      sample: context.frameEndSample,
      level: context.rms,
      normalizedLevel,
      diagnostics
    };
  }

  makeEvent(context, eventClass, score) {
    let peakIndex = 0;
    let peak = 0;
    for (let i = 0; i < context.hop.length; i += 1) {
      const absolute = Math.abs(context.hop[i]);
      if (absolute > peak) {
        peak = absolute;
        peakIndex = i;
      }
    }
    const sample = context.frameEndSample - context.hop.length + peakIndex;
    return {
      sample,
      timeSec: sample / context.sampleRate,
      detectedAtSec: context.frameEndSample / context.sampleRate,
      class: eventClass,
      score
    };
  }
}

export function classifyCentroid(centroid) {
  return centroid < 1800 ? 'lowTransient' : 'highTransient';
}
