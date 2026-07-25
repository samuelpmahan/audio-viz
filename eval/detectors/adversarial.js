function emptyOutput() {
  return { frames: [], events: [] };
}

class BlockDetector {
  initialize(config = {}) { this.config = Object.freeze({ ...config }); this.reset(); }
  reset() { this.sampleRate = null; this.expectedSample = 0; this.lastActive = false; }
  check(samples, metadata) {
    if (!(samples instanceof Float32Array)) throw new TypeError('samples must be Float32Array');
    if (this.sampleRate === null) this.sampleRate = metadata.sampleRate;
    if (metadata.sampleRate !== this.sampleRate || metadata.frameStartSample !== this.expectedSample) throw new Error('invalid stream');
    this.expectedSample += samples.length;
  }
  event(sample, eventClass, score = 1) {
    return { sample, timeSec: sample / this.sampleRate, detectedAtSec: this.expectedSample / this.sampleRate, class: eventClass, score };
  }
}

export class NoEventsDetector extends BlockDetector {
  static id = 'null-none'; static version = '1.0.0';
  process(samples, metadata) { this.check(samples, metadata); return emptyOutput(); }
}

export class FixedPeriodDetector extends BlockDetector {
  static id = 'null-fixed-period'; static version = '1.0.0';
  reset() { super.reset(); this.nextEvent = 0; }
  process(samples, metadata) {
    this.check(samples, metadata);
    const events = [];
    const period = Math.round(this.sampleRate * 0.5);
    while (this.nextEvent < this.expectedSample) {
      if (this.nextEvent >= metadata.frameStartSample) events.push(this.event(this.nextEvent, 'lowTransient'));
      this.nextEvent += period;
    }
    return { frames: [], events };
  }
}

class EveryActiveBlockDetector extends BlockDetector {
  process(samples, metadata) {
    this.check(samples, metadata);
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
    return { frames: [], events: peak > 0.04 ? [this.event(metadata.frameStartSample, this.eventClass)] : [] };
  }
}
export class EveryLowDetector extends EveryActiveBlockDetector { static id = 'null-every-low'; static version = '1.0.0'; eventClass = 'lowTransient'; }
export class EveryHighDetector extends EveryActiveBlockDetector { static id = 'null-every-high'; static version = '1.0.0'; eventClass = 'highTransient'; }

export class BoundaryDetector extends BlockDetector {
  static id = 'null-boundaries'; static version = '1.0.0';
  process(samples, metadata) {
    this.check(samples, metadata);
    let active = false;
    for (const sample of samples) if (Math.abs(sample) > 0.01) { active = true; break; }
    const events = active && !this.lastActive ? [this.event(metadata.frameStartSample, 'lowTransient')] : [];
    this.lastActive = active;
    return { frames: [], events };
  }
}

export class DuplicateDetector extends BlockDetector {
  static id = 'null-duplicates'; static version = '1.0.0';
  process(samples, metadata) {
    this.check(samples, metadata);
    let index = -1;
    for (let i = 0; i < samples.length; i += 1) if (Math.abs(samples[i]) > 0.1) { index = i; break; }
    if (index < 0) return emptyOutput();
    const sample = metadata.frameStartSample + index;
    return { frames: [], events: [this.event(sample, 'highTransient'), this.event(sample + 1, 'highTransient')] };
  }
}

export const adversarialDetectors = [NoEventsDetector, FixedPeriodDetector, EveryLowDetector, EveryHighDetector, BoundaryDetector, DuplicateDetector];
