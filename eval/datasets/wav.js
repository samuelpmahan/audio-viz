import { readFile } from 'node:fs/promises';

function findChunk(buffer, wanted) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === wanted) return { offset: offset + 8, size };
    offset += 8 + size + (size % 2);
  }
  throw new Error(`WAV chunk ${wanted} not found`);
}

export async function decodeWav(filePath) {
  const buffer = await readFile(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Only RIFF/WAVE files are supported');
  const formatChunk = findChunk(buffer, 'fmt ');
  const dataChunk = findChunk(buffer, 'data');
  const format = buffer.readUInt16LE(formatChunk.offset);
  const channels = buffer.readUInt16LE(formatChunk.offset + 2);
  const sampleRate = buffer.readUInt32LE(formatChunk.offset + 4);
  const bits = buffer.readUInt16LE(formatChunk.offset + 14);
  if (!([1, 3].includes(format)) || !([16, 24, 32].includes(bits))) throw new Error(`Unsupported WAV format=${format}, bits=${bits}`);
  const bytesPerSample = bits / 8;
  const frameCount = Math.floor(dataChunk.size / (bytesPerSample * channels));
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = dataChunk.offset + (frame * channels + channel) * bytesPerSample;
      if (format === 3 && bits === 32) sum += buffer.readFloatLE(offset);
      else if (bits === 16) sum += buffer.readInt16LE(offset) / 32768;
      else if (bits === 24) sum += buffer.readIntLE(offset, 3) / 8388608;
      else sum += buffer.readInt32LE(offset) / 2147483648;
    }
    samples[frame] = sum / channels;
  }
  return { sampleRate, samples, channels, format, bitsPerSample: bits };
}
