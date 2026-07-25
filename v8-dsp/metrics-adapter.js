const EMPTY_METRICS = Object.freeze({
  bass: 0, mid: 0, treble: 0, vol: 0, centroid: 0,
  isKick: false, isSnare: false,
  bassHit: 0, midHit: 0, highHit: 0,
  bassPresence: 0, midPresence: 0, highPresence: 0,
  bassTime: 0, midTime: 0, highTime: 0,
  bpm: 0, onBeat: 0, beatPhase: 0,
  lfo2: 0, lfo4: 0, lfo8: 0, ramp2: 0, ramp4: 0, ramp8: 0
});

export class MetricsAdapter {
  constructor() { this.reset(); }
  reset() {
    this.metrics = { ...EMPTY_METRICS };
    this.hit = { low: 0, mid: 0, high: 0 };
    this.presence = { low: 0, mid: 0, high: 0 };
    this.lastEventSec = { low: null, mid: null, high: null };
    this.recentEvents = [];
  }

  update({ frame, levels, interpretation, rhythm, modulation, timeSec, presentationOffsetSec, config, processing }) {
    const delta = Math.max(0, timeSec - (this.previousTimeSec ?? timeSec));
    this.previousTimeSec = timeSec;
    this.metrics.isKick = false;
    this.metrics.isSnare = false;
    for (const band of ['low', 'mid', 'high']) this.hit[band] *= Math.exp(-delta / 0.095);
    for (const event of interpretation.events) {
      this.hit[event.band] = 1;
      this.lastEventSec[event.band] = event.timeSec + presentationOffsetSec;
      if (event.band === 'low') this.metrics.isKick = true;
      if (event.band === 'high') this.metrics.isSnare = true;
      this.recentEvents.unshift({ ...event, presentationTimeSec: event.timeSec + presentationOffsetSec });
    }
    this.recentEvents = this.recentEvents.filter((event) => timeSec - event.timeSec < 4).slice(0, 16);
    for (const band of ['low', 'mid', 'high']) this.presence[band] += ((band === 'low' ? levels.bass : band === 'mid' ? levels.mid : levels.treble) - this.presence[band]) * (1 - Math.exp(-delta / 2.8));
    Object.assign(this.metrics, {
      bass: levels.bass, mid: levels.mid, treble: levels.treble, vol: frame.rms, centroid: frame.centroid,
      bassHit: this.hit.low, midHit: this.hit.mid, highHit: this.hit.high,
      bassPresence: this.presence.low, midPresence: this.presence.mid, highPresence: this.presence.high,
      bassTime: this.lastEventSec.low === null ? 0 : Math.max(0, (timeSec - this.lastEventSec.low) * 1000),
      midTime: this.lastEventSec.mid === null ? 0 : Math.max(0, (timeSec - this.lastEventSec.mid) * 1000),
      highTime: this.lastEventSec.high === null ? 0 : Math.max(0, (timeSec - this.lastEventSec.high) * 1000),
      bpm: rhythm.bpm ? Math.round(rhythm.bpm) : 0, onBeat: rhythm.onBeat, beatPhase: rhythm.beatPhase,
      ...modulation,
      globalOnset: frame.onset.global,
      lowOnset: frame.onset.low,
      midOnset: frame.onset.mid,
      highOnset: frame.onset.high,
      lowTransient: interpretation.probability.low,
      highTransient: interpretation.probability.high,
      rhythmConfidence: rhythm.confidence,
      normalizedLevel: levels.vol,
      appliedPresentationOffsetMs: presentationOffsetSec * 1000,
      activeEngineConfiguration: { ...config },
      analysisProcessingMeanMs: processing.meanMs,
      analysisProcessingP95Ms: processing.p95Ms
    });
    return this.metrics;
  }
}

export function createEmptyMetrics() { return { ...EMPTY_METRICS }; }
