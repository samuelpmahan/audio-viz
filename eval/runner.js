import { performance } from 'node:perf_hooks';
import { mean, percentile } from './core/math.js';

export const AUDIO_WORKLET_BLOCK_SIZE = 128;

function validateOutput(output, processedThroughSample, sampleRate) {
  if (!output || !Array.isArray(output.frames) || !Array.isArray(output.events)) throw new Error('detector returned an invalid output');
  for (const event of output.events) {
    if (event.sample >= processedThroughSample || event.detectedAtSec > processedThroughSample / sampleRate + 1e-12) throw new Error('detector emitted an event from a future block');
  }
  for (const frame of output.frames) {
    if (frame.sample > processedThroughSample) throw new Error('detector emitted a frame from a future block');
  }
}

export async function runFixture(detector, fixture, { mode = 'fast', blockSize = AUDIO_WORKLET_BLOCK_SIZE } = {}) {
  if (!['fast', 'browser'].includes(mode)) throw new Error(`Unknown execution mode: ${mode}`);
  if (mode === 'browser' && blockSize !== AUDIO_WORKLET_BLOCK_SIZE) throw new Error('browser mode requires 128-sample blocks');
  detector.reset();
  const frames = [];
  const events = [];
  const blockTimesMs = [];
  const heapStartBytes = process.memoryUsage().heapUsed;
  const wallStart = performance.now();
  for (let start = 0; start < fixture.samples.length; start += blockSize) {
    // A fresh, exact-sized buffer prevents access through the underlying full-file ArrayBuffer.
    const block = fixture.samples.slice(start, Math.min(start + blockSize, fixture.samples.length));
    const metadata = Object.freeze({
      sampleRate: fixture.sampleRate,
      frameStartSample: start,
      contextTimeSec: start / fixture.sampleRate
    });
    const processStart = performance.now();
    let output = detector.process(block, metadata);
    if (mode === 'browser') {
      // Model the structured-clone/message boundary without wall-clock throttling.
      output = structuredClone(output);
    }
    blockTimesMs.push(performance.now() - processStart);
    validateOutput(output, start + block.length, fixture.sampleRate);
    frames.push(...output.frames);
    events.push(...output.events);
  }
  const wallMs = performance.now() - wallStart;
  const heapEndBytes = process.memoryUsage().heapUsed;
  const quantumMs = (AUDIO_WORKLET_BLOCK_SIZE / fixture.sampleRate) * 1000;
  return {
    fixture,
    frames,
    events,
    runtime: {
      mode,
      sampleRate: fixture.sampleRate,
      blockSize,
      blocks: blockTimesMs.length,
      meanProcessingMsPer128Block: mean(blockTimesMs) * AUDIO_WORKLET_BLOCK_SIZE / blockSize,
      p95ProcessingMs: percentile(blockTimesMs, 0.95),
      p99ProcessingMs: percentile(blockTimesMs, 0.99),
      maxProcessingMs: Math.max(...blockTimesMs, 0),
      totalWallMs: wallMs,
      audioDurationSec: fixture.durationSec,
      throughputXRealtime: fixture.durationSec / Math.max(wallMs / 1000, 1e-12),
      lateBlocks: blockTimesMs.filter((duration) => duration > quantumMs).length,
      droppedBlocks: 0,
      heapGrowthBytes: heapEndBytes - heapStartBytes,
      allocationMeasurement: 'Approximate Node heap delta; GC and process-wide allocations make this environment-dependent.'
    }
  };
}

export function compareEventStreams(fastResult, browserResult, toleranceSamples = 0) {
  if (fastResult.events.length !== browserResult.events.length) return { equivalent: false, reason: 'event count differs' };
  for (let i = 0; i < fastResult.events.length; i += 1) {
    const fast = fastResult.events[i];
    const browser = browserResult.events[i];
    if (fast.class !== browser.class || Math.abs(fast.sample - browser.sample) > toleranceSamples) {
      return { equivalent: false, reason: `event ${i} differs`, fast, browser };
    }
  }
  return { equivalent: true, toleranceSamples };
}
