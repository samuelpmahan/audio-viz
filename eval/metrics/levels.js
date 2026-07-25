import { mean, percentile } from '../core/math.js';

function firstCrossing(frames, startSec, predicate) {
  return frames.find((frame) => frame.timeSec >= startSec && predicate(frame));
}

export function scoreLevelBehavior(frames, fixture) {
  if (!frames.length) return { available: false };
  const normalized = frames.map((frame) => frame.normalizedLevel ?? frame.level);
  const result = {
    available: true,
    steadyStateVariation: 0,
    noiseFloor: percentile(frames.filter((frame) => frame.level < 0.01).map((frame) => frame.normalizedLevel ?? frame.level), 0.95),
    clippingFrames: frames.filter((frame) => frame.level >= 0.7).length,
    attackTimeMs: null,
    releaseTimeMs: null,
    recoveryTimeMs: null,
    overshoot: Math.max(...normalized, 0) - 1
  };
  const steady = normalized.slice(Math.floor(normalized.length * 0.6));
  result.steadyStateVariation = steady.length ? Math.max(...steady) - Math.min(...steady) : 0;
  for (const transition of fixture.levelTransitions ?? []) {
    const before = frames.filter((frame) => frame.timeSec < transition.timeSec).slice(-5);
    const after = frames.filter((frame) => frame.timeSec >= transition.timeSec && frame.timeSec < transition.timeSec + 0.5);
    if (!after.length) continue;
    if (transition.kind === 'attack') {
      const target = Math.max(...after.map((frame) => frame.normalizedLevel ?? frame.level)) * 0.9;
      const crossing = firstCrossing(frames, transition.timeSec, (frame) => (frame.normalizedLevel ?? frame.level) >= target);
      if (crossing) result.attackTimeMs = (crossing.timeSec - transition.timeSec) * 1000;
    } else if (transition.kind === 'release') {
      const baseline = mean(before.map((frame) => frame.normalizedLevel ?? frame.level));
      const crossing = firstCrossing(frames, transition.timeSec, (frame) => (frame.normalizedLevel ?? frame.level) <= baseline * 0.1);
      if (crossing) result.releaseTimeMs = (crossing.timeSec - transition.timeSec) * 1000;
    } else if (transition.kind === 'levelDrop') {
      const tail = after.slice(-5);
      const target = mean(tail.map((frame) => frame.normalizedLevel ?? frame.level)) * 1.1;
      const crossing = firstCrossing(frames, transition.timeSec, (frame) => (frame.normalizedLevel ?? frame.level) <= target);
      if (crossing) result.recoveryTimeMs = (crossing.timeSec - transition.timeSec) * 1000;
    }
  }
  return result;
}
