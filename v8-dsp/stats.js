export const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * ratio));
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction;
}

export function medianAbsoluteDeviation(values, center = median(values)) {
  return median(values.map((value) => Math.abs(value - center)));
}

export function circularDistance(a, b) {
  const distance = Math.abs(a - b) % 1;
  return Math.min(distance, 1 - distance);
}

export function lerpCircular(from, to, amount) {
  let delta = ((to - from + 1.5) % 1) - 0.5;
  return (from + delta * amount + 1) % 1;
}
