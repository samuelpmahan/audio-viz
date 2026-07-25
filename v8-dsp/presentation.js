import { clamp01, lerpCircular } from './stats.js';

export const LFO_CLOCKS = Object.freeze(['v7-bpm', 'phase-follower', 'fixed', 'free-running', 'disabled']);
export const LOW_CONFIDENCE_BEHAVIORS = Object.freeze(['hold', 'free-running', 'reduce-depth', 'disable']);
export const LATENCY_MODES = Object.freeze(['none', 'base-latency', 'output-latency', 'manual-offset']);

export function presentationOffset(context, mode, manualOffsetMs = 0) {
  if (mode === 'base-latency') return Number.isFinite(context?.baseLatency) ? context.baseLatency : 0;
  if (mode === 'output-latency') return Number.isFinite(context?.outputLatency) ? context.outputLatency : 0;
  if (mode === 'manual-offset') return Math.max(-0.5, Math.min(0.5, manualOffsetMs / 1000));
  return 0;
}

export class PresentationQueue {
  constructor() { this.clear(); }

  clear() {
    this.entries = [];
    this.lastOldestFrameLatenessMs = 0;
  }

  enqueue(frames, offsetSec, availableTimeSec) {
    for (const frame of frames) {
      const presentationTimeSec = frame.timeSec + offsetSec;
      this.entries.push({
        frame,
        requestedOffsetSec: offsetSec,
        presentationTimeSec,
        releaseTimeSec: Math.max(presentationTimeSec, availableTimeSec)
      });
    }
    this.entries.sort((left, right) => left.releaseTimeSec - right.releaseTimeSec || left.frame.frameEndSample - right.frame.frameEndSample);
  }

  release(currentTimeSec) {
    let count = 0;
    while (count < this.entries.length && this.entries[count].releaseTimeSec <= currentTimeSec) count += 1;
    this.lastOldestFrameLatenessMs = count ? Math.max(0, (currentTimeSec - this.entries[0].releaseTimeSec) * 1000) : 0;
    return count ? this.entries.splice(0, count) : [];
  }

  debugState() {
    return {
      depth: this.entries.length,
      oldestFrameLatenessMs: this.lastOldestFrameLatenessMs
    };
  }
}

export class ModulationClock {
  constructor() { this.reset(); }
  reset() { this.phase = 0; this.lastTimeSec = null; this.heldBpm = 0; }

  update(timeSec, rhythm, config) {
    const delta = this.lastTimeSec === null ? 0 : Math.max(0, Math.min(0.1, timeSec - this.lastTimeSec));
    this.lastTimeSec = timeSec;
    let bpm = 0;
    if (config.lfoClock === 'v7-bpm') bpm = rhythm.bpm || 120;
    else if (config.lfoClock === 'fixed') bpm = config.fixedBpm;
    else if (config.lfoClock === 'free-running') bpm = config.fixedBpm || 90;
    else if (config.lfoClock === 'phase-follower') bpm = rhythm.bpm;
    if (rhythm.confidence >= 0.35 && rhythm.bpm) this.heldBpm = rhythm.bpm;
    let depth = 1;
    if (config.lfoClock === 'disabled') depth = 0;
    else if (config.lfoClock === 'phase-follower' && rhythm.confidence < 0.35) {
      if (config.lowConfidence === 'hold') bpm = this.heldBpm;
      else if (config.lowConfidence === 'free-running') bpm = (rhythm.confidence / 0.35) * (bpm || this.heldBpm) + (1 - rhythm.confidence / 0.35) * (config.fixedBpm || 90);
      else if (config.lowConfidence === 'reduce-depth') { bpm = bpm || this.heldBpm; depth = clamp01(rhythm.confidence / 0.35); }
      else { bpm = 0; depth = 0; }
    }
    if (bpm > 0) this.phase = (this.phase + delta * bpm / 60) % 8;
    if (config.lfoClock === 'phase-follower' && rhythm.confidence > 0.55) this.phase = lerpCircular(this.phase % 1, rhythm.beatPhase, 0.08) + Math.floor(this.phase);
    const values = {};
    for (const beats of [2, 4, 8]) {
      const phase = (this.phase / beats) % 1;
      values[`lfo${beats}`] = 0.5 + Math.sin(phase * Math.PI * 2) * 0.5 * depth;
      values[`ramp${beats}`] = depth ? phase : 0;
    }
    return values;
  }
}
