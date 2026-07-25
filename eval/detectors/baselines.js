import { WindowedDetector, classifyCentroid } from '../core/detector.js';
import { bandEnergy } from '../core/fft.js';

function levelFollower(detector, rms) {
  detector.levelPeak = Math.max(rms, detector.levelPeak * detector.config.peakRelease);
  return detector.levelPeak > 1e-6 ? Math.min(1, rms / detector.levelPeak) : 0;
}

export class CurrentBaseline extends WindowedDetector {
  static id = 'current-baseline';
  static version = '1.0.0';
  defaultConfig = Object.freeze({
    windowSize: 2048,
    hopSize: 512,
    analyserSmoothing: 0.4,
    averageAlpha: 0.04,
    thresholdMultiplier: 1.2,
    minimumFlux: 0.5,
    lowCentroidRatio: 0.35,
    lowCooldownSec: 0.15,
    highCooldownSec: 0.1,
    peakRelease: 0.999
  });

  resetState() {
    this.previousBytes = null;
    this.smoothedBytes = null;
    this.averageFlux = 0;
    this.lastEvent = { lowTransient: -Infinity, highTransient: -Infinity };
    this.levelPeak = 1e-6;
  }

  analyzeFrame(context) {
    const bytes = new Uint8Array(context.spectrum.length);
    if (!this.smoothedBytes) this.smoothedBytes = new Float64Array(context.spectrum.length);
    for (let i = 0; i < context.spectrum.length; i += 1) {
      const db = 20 * Math.log10(context.spectrum[i] / context.window.length + 1e-12);
      const raw = Math.max(0, Math.min(255, ((db + 100) / 70) * 255));
      this.smoothedBytes[i] = this.config.analyserSmoothing * this.smoothedBytes[i] + (1 - this.config.analyserSmoothing) * raw;
      bytes[i] = Math.round(this.smoothedBytes[i]);
    }
    let flux = 0;
    if (this.previousBytes) {
      for (let i = 0; i < bytes.length; i += 1) flux += Math.abs(bytes[i] - this.previousBytes[i]);
      flux /= bytes.length;
    }
    this.previousBytes = bytes;
    this.averageFlux = this.averageFlux * (1 - this.config.averageAlpha) + flux * this.config.averageAlpha;
    const threshold = Math.max(this.config.minimumFlux, this.averageFlux * this.config.thresholdMultiplier);
    const eventClass = context.centroid / (context.sampleRate / 2) < this.config.lowCentroidRatio
      ? 'lowTransient'
      : 'highTransient';
    const now = context.frameEndSample / context.sampleRate;
    const cooldown = eventClass === 'lowTransient' ? this.config.lowCooldownSec : this.config.highCooldownSec;
    const events = flux > threshold && now - this.lastEvent[eventClass] > cooldown
      ? [this.makeEvent(context, eventClass, flux / Math.max(threshold, 1e-9))]
      : [];
    if (events.length) this.lastEvent[eventClass] = now;
    return {
      frame: this.makeFrame(context, levelFollower(this, context.rms), { flux, threshold, centroid: context.centroid }),
      events
    };
  }
}

export class SpectralFluxBaseline extends WindowedDetector {
  static id = 'spectral-flux-baseline';
  static version = '1.0.0';
  defaultConfig = Object.freeze({
    windowSize: 512,
    hopSize: 128,
    averageAlpha: 0.08,
    thresholdMultiplier: 2.0,
    minimumFlux: 0.012,
    cooldownSec: 0.055,
    peakRelease: 0.999
  });

  resetState() {
    this.previousSpectrum = null;
    this.averageFlux = 0;
    this.lastEventSec = -Infinity;
    this.levelPeak = 1e-6;
  }

  analyzeFrame(context) {
    let positive = 0;
    let previousTotal = 0;
    if (this.previousSpectrum) {
      for (let i = 0; i < context.spectrum.length; i += 1) {
        positive += Math.max(0, context.spectrum[i] - this.previousSpectrum[i]);
        previousTotal += this.previousSpectrum[i];
      }
    }
    const flux = positive / Math.max(1e-9, previousTotal);
    this.previousSpectrum = context.spectrum;
    const threshold = Math.max(this.config.minimumFlux, this.averageFlux * this.config.thresholdMultiplier);
    const now = context.frameEndSample / context.sampleRate;
    const triggered = this.averageFlux > 0 && flux > threshold && now - this.lastEventSec > this.config.cooldownSec;
    this.averageFlux = this.averageFlux * (1 - this.config.averageAlpha) + flux * this.config.averageAlpha;
    const events = triggered ? [this.makeEvent(context, classifyCentroid(context.centroid), flux / threshold)] : [];
    if (events.length) this.lastEventSec = now;
    return {
      frame: this.makeFrame(context, levelFollower(this, context.rms), { flux, threshold, centroid: context.centroid }),
      events
    };
  }
}

export class MultibandEnergyBaseline extends WindowedDetector {
  static id = 'multiband-energy-baseline';
  static version = '1.0.0';
  defaultConfig = Object.freeze({
    windowSize: 512,
    hopSize: 128,
    averageAlpha: 0.06,
    thresholdRatio: 2.4,
    minimumDelta: 1e-7,
    lowBandHighHz: 250,
    highBandLowHz: 2500,
    cooldownSec: 0.055,
    peakRelease: 0.999
  });

  resetState() {
    this.average = { lowTransient: 1e-9, highTransient: 1e-9 };
    this.previous = { lowTransient: 0, highTransient: 0 };
    this.lastEvent = { lowTransient: -Infinity, highTransient: -Infinity };
    this.levelPeak = 1e-6;
  }

  analyzeFrame(context) {
    const energy = {
      lowTransient: bandEnergy(context.spectrum, context.sampleRate, 35, this.config.lowBandHighHz),
      highTransient: bandEnergy(context.spectrum, context.sampleRate, this.config.highBandLowHz, Math.min(16000, context.sampleRate / 2))
    };
    const events = [];
    const now = context.frameEndSample / context.sampleRate;
    for (const eventClass of ['lowTransient', 'highTransient']) {
      const difference = Math.max(0, energy[eventClass] - this.previous[eventClass]);
      const threshold = Math.max(this.config.minimumDelta, this.average[eventClass] * this.config.thresholdRatio);
      if (difference > threshold && now - this.lastEvent[eventClass] > this.config.cooldownSec) {
        events.push(this.makeEvent(context, eventClass, difference / threshold));
        this.lastEvent[eventClass] = now;
      }
      this.average[eventClass] = this.average[eventClass] * (1 - this.config.averageAlpha) + difference * this.config.averageAlpha;
      this.previous[eventClass] = energy[eventClass];
    }
    return {
      frame: this.makeFrame(context, levelFollower(this, context.rms), { energy }),
      events
    };
  }
}

// Mirrors the existing Meyda feature strategy (RMS + centroid) without importing
// the browser-only analyser. This keeps CI dependency-free and deterministic.
export class MeydaFeatureBaseline extends WindowedDetector {
  static id = 'meyda-feature-baseline';
  static version = '1.0.0';
  defaultConfig = Object.freeze({
    windowSize: 512,
    hopSize: 128,
    averageAlpha: 0.04,
    riseMultiplier: 1.7,
    minimumRise: 0.003,
    cooldownSec: 0.06,
    peakRelease: 0.999
  });

  resetState() {
    this.previousRms = 0;
    this.averageRise = 0;
    this.lastEventSec = -Infinity;
    this.levelPeak = 1e-6;
  }

  analyzeFrame(context) {
    const rise = Math.max(0, context.rms - this.previousRms);
    const threshold = Math.max(this.config.minimumRise, this.averageRise * this.config.riseMultiplier);
    const now = context.frameEndSample / context.sampleRate;
    const triggered = rise > threshold && context.rms > 0.006 && now - this.lastEventSec > this.config.cooldownSec;
    this.averageRise = this.averageRise * (1 - this.config.averageAlpha) + rise * this.config.averageAlpha;
    this.previousRms = context.rms;
    const events = triggered ? [this.makeEvent(context, classifyCentroid(context.centroid), rise / threshold)] : [];
    if (events.length) this.lastEventSec = now;
    return {
      frame: this.makeFrame(context, levelFollower(this, context.rms), { rmsRise: rise, threshold, centroid: context.centroid }),
      events
    };
  }
}

export const baselineDetectors = [CurrentBaseline, SpectralFluxBaseline, MultibandEnergyBaseline, MeydaFeatureBaseline];
