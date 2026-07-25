import { SequentialAnalysisCore } from '../v8-dsp/analysis-core.js';

class AudioAnalysisV8Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.core = new SequentialAnalysisCore(options.processorOptions?.config);
    this.nextSample = null;
    this.port.postMessage({ type: 'ready' });
    this.port.onmessage = ({ data }) => {
      if (data.type === 'configure') {
        this.core.configure(data.config);
        this.nextSample = null;
        this.port.postMessage({ type: 'reset', atSample: this.nextSample });
      } else if (data.type === 'reset') {
        this.core.reset();
        this.nextSample = null;
        this.port.postMessage({ type: 'reset', atSample: this.nextSample });
      }
    };
  }

  process(inputs) {
    try {
      const input = inputs[0]?.[0];
      if (!input) return true;
      if (this.nextSample === null) this.nextSample = currentFrame;
      const frames = this.core.process(new Float32Array(input), {
        sampleRate,
        frameStartSample: this.nextSample,
        contextTimeSec: this.nextSample / sampleRate
      });
      this.nextSample += input.length;
      if (frames.length) this.port.postMessage({ type: 'frames', frames, processingMs: null, blockSize: input.length, processingClockAvailable: false });
      return true;
    } catch (error) {
      this.port.postMessage({ type: 'processor-exception', message: error?.message ?? String(error), stack: error?.stack ?? null });
      return false;
    }
  }
}

registerProcessor('audio-analysis-v8', AudioAnalysisV8Processor);
