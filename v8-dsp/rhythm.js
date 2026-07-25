import { clamp01, circularDistance, median } from './stats.js';

export const RHYTHM_MODES = Object.freeze(['v7-interval-average', 'interval-median', 'tempo-candidates', 'phase-follower', 'off']);

function foldPeriod(period) {
  let result = period;
  while (result < 60 / 180) result *= 2;
  while (result > 60 / 60) result /= 2;
  return result;
}

export class RhythmTracker {
  constructor(mode = 'phase-follower') { this.configure(mode); }

  configure(mode) {
    this.mode = RHYTHM_MODES.includes(mode) ? mode : 'phase-follower';
    this.reset();
  }

  reset() {
    this.onsets = [];
    this.period = this.mode === 'v7-interval-average' ? 0.5 : 0;
    this.anchorSec = 0;
    this.confidence = 0;
    this.lastUpdateSec = 0;
    this.candidates = [];
  }

  addOnset(timeSec, strength = 1) {
    if (this.mode === 'off') return;
    const previous = this.onsets.at(-1);
    if (previous && timeSec - previous.timeSec < 0.18) return;
    this.onsets.push({ timeSec, strength });
    if (this.onsets.length > 16) this.onsets.shift();
    if (this.onsets.length < 4) return;
    const intervals = this.onsets.slice(1).map((entry, index) => entry.timeSec - this.onsets[index].timeSec).filter((value) => value >= 0.2 && value <= 2);
    if (!intervals.length) return;
    if (this.mode === 'v7-interval-average') {
      this.period = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      const variance = intervals.reduce((sum, value) => sum + (value - this.period) ** 2, 0) / intervals.length;
      this.confidence = clamp01(1 - Math.sqrt(variance) / this.period);
      this.anchorSec = timeSec;
      return;
    }
    if (this.mode === 'interval-median') {
      const estimate = median(intervals);
      const error = median(intervals.map((value) => Math.abs(value - estimate))) / estimate;
      this.period = this.period ? this.period * 0.75 + estimate * 0.25 : estimate;
      this.confidence = clamp01((1 - error * 4) * Math.min(1, intervals.length / 6));
      this.anchorSec = timeSec;
      return;
    }
    const hypotheses = [];
    for (const interval of intervals.slice(-10)) {
      const folded = foldPeriod(interval);
      for (const period of [folded, foldPeriod(folded * 2), foldPeriod(folded / 2)]) {
        let hypothesis = hypotheses.find((candidate) => Math.abs(candidate.period - period) / period < 0.06);
        if (!hypothesis) { hypothesis = { period, score: 0 }; hypotheses.push(hypothesis); }
        hypothesis.score += 1;
      }
    }
    hypotheses.sort((a, b) => b.score - a.score || Math.abs(a.period - (this.period || 0.5)) - Math.abs(b.period - (this.period || 0.5)));
    this.candidates = hypotheses.slice(0, 4);
    const winner = this.candidates[0];
    const consistency = winner.score / Math.max(1, intervals.length);
    const newConfidence = clamp01((consistency - 0.35) / 0.65 * Math.min(1, intervals.length / 6));
    if (!this.period) this.period = winner.period;
    else if (Math.abs(winner.period - this.period) / this.period < 0.18 || newConfidence > this.confidence + 0.2) this.period += (winner.period - this.period) * 0.16;
    if (this.mode === 'phase-follower' && this.period) {
      const predictedPhase = ((timeSec - this.anchorSec) / this.period % 1 + 1) % 1;
      const correction = Math.min(0.12, circularDistance(predictedPhase, 0) * 0.35);
      const targetAnchor = timeSec - Math.round((timeSec - this.anchorSec) / this.period) * this.period;
      this.anchorSec += (targetAnchor - this.anchorSec) * correction;
    } else this.anchorSec = timeSec;
    const agreement = this.period ? 1 - Math.min(1, Math.abs(foldPeriod(intervals.at(-1)) - this.period) / this.period * 4) : 0;
    this.confidence = clamp01(this.confidence * 0.68 + newConfidence * agreement * 0.32);
  }

  update(timeSec) {
    const delta = Math.max(0, timeSec - this.lastUpdateSec);
    this.lastUpdateSec = timeSec;
    const silenceAge = this.onsets.length ? timeSec - this.onsets.at(-1).timeSec : Infinity;
    if (silenceAge > Math.max(1.5, this.period * 3 || 1.5)) this.confidence *= Math.exp(-delta * 1.2);
    if (this.mode === 'off') return { bpm: 0, confidence: 0, beatPhase: 0, onBeat: 0, candidates: [] };
    const beatPhase = this.period ? ((timeSec - this.anchorSec) / this.period % 1 + 1) % 1 : 0;
    return {
      bpm: this.period && this.confidence > 0.08 ? 60 / this.period : 0,
      confidence: this.confidence,
      beatPhase,
      onBeat: Math.pow(Math.cos(beatPhase * Math.PI), 8) * this.confidence,
      candidates: this.candidates.map((candidate) => ({ bpm: 60 / candidate.period, score: candidate.score }))
    };
  }
}
