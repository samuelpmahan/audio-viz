const windows = new Map();

export function hann(size) {
  if (!windows.has(size)) {
    const window = new Float64Array(size);
    for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    windows.set(size, window);
  }
  return windows.get(size);
}

// Dependency-free radix-2 FFT, sufficient for deterministic baseline evaluation.
export function magnitudeSpectrum(samples) {
  const size = samples.length;
  if ((size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  const window = hann(size);
  for (let i = 0; i < size; i += 1) real[i] = samples[i] * window[i];

  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const baseReal = Math.cos(angle);
    const baseImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * baseReal - twiddleImaginary * baseImaginary;
        twiddleImaginary = twiddleReal * baseImaginary + twiddleImaginary * baseReal;
        twiddleReal = nextReal;
      }
    }
  }

  const result = new Float64Array(size / 2);
  for (let i = 0; i < result.length; i += 1) result[i] = Math.hypot(real[i], imaginary[i]);
  return result;
}

export function spectralCentroid(spectrum, sampleRate) {
  let weighted = 0;
  let total = 0;
  const binWidth = sampleRate / (spectrum.length * 2);
  for (let i = 0; i < spectrum.length; i += 1) {
    weighted += spectrum[i] * i * binWidth;
    total += spectrum[i];
  }
  return total > 1e-12 ? weighted / total : 0;
}

export function bandEnergy(spectrum, sampleRate, lowHz, highHz) {
  const binWidth = sampleRate / (spectrum.length * 2);
  const low = Math.max(0, Math.ceil(lowHz / binWidth));
  const high = Math.min(spectrum.length, Math.floor(highHz / binWidth) + 1);
  let energy = 0;
  for (let i = low; i < high; i += 1) energy += spectrum[i] * spectrum[i];
  return energy / Math.max(1, high - low);
}
