import { SequentialAnalysisCore } from './v8-dsp/analysis-core.js';
import { browserConfig, persistConfig, validateConfig } from './v8-dsp/config.js';
import { LevelNormalizer } from './v8-dsp/normalization.js';
import { TransientInterpreter } from './v8-dsp/transients.js';
import { RhythmTracker } from './v8-dsp/rhythm.js';
import { ModulationClock, presentationOffset } from './v8-dsp/presentation.js';
import { createEmptyMetrics, MetricsAdapter } from './v8-dsp/metrics-adapter.js';

function p95(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.95)];
}

export class AudioAnalyzer {
  constructor(config = {}) {
    this.config = validateConfig({ ...browserConfig(), ...config });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 2.5;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.4;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.monitorGain = this.ctx.createGain();
    this.monitorGain.gain.value = 0;
    this.monitorGain.connect(this.ctx.destination);
    this.gainNode.connect(this.analyser);
    this.gainNode.connect(this.monitorGain);
    this.normalizer = new LevelNormalizer(this.config.normalization);
    this.interpreter = new TransientInterpreter(this.config.classifier);
    this.rhythm = new RhythmTracker(this.config.rhythm);
    this.modulation = new ModulationClock();
    this.adapter = new MetricsAdapter();
    this.metrics = createEmptyMetrics();
    this.pendingFrames = [];
    this.processingTimes = [];
    this.sourceNode = null;
    this.sourceKind = null;
    this.decodedBuffer = null;
    this.isInit = false;
    this.status = { processingMode: 'not-started', fallback: null, error: null };
    this.listeners = new Set();
  }

  async init({ source = 'microphone' } = {}) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.initializeAnalysisNode();
    if (source === 'microphone') await this.useMicrophone();
    this.isInit = true;
    return this;
  }

  async initializeAnalysisNode() {
    if (this.analysisNode) this.analysisNode.disconnect();
    try {
      await this.ctx.audioWorklet.addModule(new URL('./worklets/audio-analysis-v8-processor.js', import.meta.url));
      this.analysisNode = new AudioWorkletNode(this.ctx, 'audio-analysis-v8', { processorOptions: { config: this.config } });
      const sink = this.ctx.createGain();
      sink.gain.value = 0;
      this.analysisNode.connect(sink).connect(this.ctx.destination);
      this.analysisNode.port.onmessage = ({ data }) => this.handleAnalysisMessage(data);
      this.analysisNode.onprocessorerror = () => { this.status.error = 'AudioWorklet processor error'; };
      this.gainNode.connect(this.analysisNode);
      this.status.processingMode = 'AudioWorklet';
      this.status.fallback = null;
    } catch (error) {
      this.status.processingMode = 'ScriptProcessor fallback';
      this.status.fallback = `AudioWorklet unavailable: ${error.message}`;
      this.fallbackCore = new SequentialAnalysisCore(this.config);
      this.fallbackSample = 0;
      this.analysisNode = this.ctx.createScriptProcessor(1024, 1, 1);
      this.analysisNode.onaudioprocess = (event) => {
        const input = new Float32Array(event.inputBuffer.getChannelData(0));
        const started = performance.now();
        const frames = this.fallbackCore.process(input, { sampleRate: this.ctx.sampleRate, frameStartSample: this.fallbackSample, contextTimeSec: this.fallbackSample / this.ctx.sampleRate });
        this.fallbackSample += input.length;
        this.handleAnalysisMessage({ type: 'frames', frames, processingMs: performance.now() - started, blockSize: input.length });
      };
      this.gainNode.connect(this.analysisNode);
      this.analysisNode.connect(this.ctx.destination);
    }
  }

  handleAnalysisMessage(message) {
    if (message.type === 'ready') this.status.workletReady = true;
    if (message.type === 'processor-exception') this.status.error = `AudioWorklet: ${message.message}`;
    if (message.type === 'frames') {
      this.pendingFrames.push(...message.frames);
      if (Number.isFinite(message.processingMs)) this.processingTimes.push(message.processingMs * 128 / message.blockSize);
      if (message.processingClockAvailable === false) this.status.processingClockUnavailable = true;
      if (this.processingTimes.length > 600) this.processingTimes.shift();
    }
  }

  disconnectSource() {
    if (!this.sourceNode) return;
    try { this.sourceNode.stop?.(); } catch { /* already stopped */ }
    this.sourceNode.disconnect();
    this.sourceNode = null;
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
  }

  async useMicrophone() {
    this.disconnectSource();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.mediaStream = stream;
    this.sourceNode = this.ctx.createMediaStreamSource(stream);
    this.sourceNode.connect(this.gainNode);
    this.sourceKind = 'microphone';
    this.monitorGain.gain.value = 0;
    this.reset();
  }

  async loadAudioFile(file) {
    if (!file) return;
    this.decodedBuffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    await this.replayFile();
  }

  async replayFile() {
    if (!this.decodedBuffer) throw new Error('No local audio file has been loaded');
    this.disconnectSource();
    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = this.decodedBuffer;
    this.sourceNode.connect(this.gainNode);
    this.sourceNode.start();
    this.sourceKind = 'local-file';
    this.monitorGain.gain.value = 1;
    this.reset();
  }

  setGain(value) { this.gainNode.gain.value = value; }
  getRawData() { return this.dataArray; }
  getMetrics() { return this.metrics; }
  onConfigurationChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  setConfig(patch, { persist = true } = {}) {
    const previous = this.config;
    this.config = validateConfig({ ...this.config, ...patch });
    if (persist) persistConfig(this.config);
    if (previous.analysis !== this.config.analysis) {
      if (this.status.processingMode === 'AudioWorklet') this.analysisNode?.port.postMessage({ type: 'configure', config: this.config });
      else this.fallbackCore?.configure(this.config);
    }
    this.normalizer.configure(this.config.normalization);
    this.interpreter.configure(this.config.classifier);
    this.rhythm.configure(this.config.rhythm);
    this.modulation.reset();
    this.adapter.reset();
    this.pendingFrames.length = 0;
    for (const listener of this.listeners) listener(this.config);
    return this.config;
  }

  reset() {
    this.pendingFrames.length = 0;
    this.processingTimes.length = 0;
    this.normalizer.reset();
    this.interpreter.reset();
    this.rhythm.reset();
    this.modulation.reset();
    this.adapter.reset();
    if (this.status.processingMode === 'AudioWorklet') this.analysisNode?.port.postMessage({ type: 'reset' });
    else { this.fallbackCore?.reset(); this.fallbackSample = 0; }
  }

  update() {
    if (!this.isInit) return;
    this.analyser.getByteFrequencyData(this.dataArray);
    const offset = presentationOffset(this.ctx, this.config.latency, this.config.manualOffsetMs);
    let sawKick = false;
    let sawSnare = false;
    while (this.pendingFrames.length) {
      const frame = this.pendingFrames.shift();
      const levels = this.normalizer.process({ ...frame.bands, overall: frame.rms });
      const interpretation = this.interpreter.process(frame);
      for (const event of interpretation.events) if (event.band === 'low' || event.band === 'high') this.rhythm.addOnset(event.timeSec, event.score);
      const rhythm = this.rhythm.update(frame.timeSec + offset);
      const modulation = this.modulation.update(frame.timeSec + offset, rhythm, this.config);
      const meanMs = this.processingTimes.length ? this.processingTimes.reduce((sum, value) => sum + value, 0) / this.processingTimes.length : 0;
      this.metrics = this.adapter.update({ frame, levels, interpretation, rhythm, modulation, timeSec: frame.timeSec + offset, presentationOffsetSec: offset, config: this.config, processing: { meanMs, p95Ms: p95(this.processingTimes) } });
      sawKick ||= this.metrics.isKick;
      sawSnare ||= this.metrics.isSnare;
    }
    if (sawKick) this.metrics.isKick = true;
    if (sawSnare) this.metrics.isSnare = true;
  }

  getDebugState() {
    return {
      config: this.config,
      sampleRate: this.ctx.sampleRate,
      processingMode: this.status.processingMode,
      processingClockAvailable: !this.status.processingClockUnavailable,
      workletReady: Boolean(this.status.workletReady),
      sourceKind: this.sourceKind,
      latency: { baseLatency: this.ctx.baseLatency ?? null, outputLatency: this.ctx.outputLatency ?? null, appliedMs: this.metrics.appliedPresentationOffsetMs ?? 0 },
      metrics: this.metrics,
      recentEvents: this.adapter.recentEvents,
      fallback: this.status.fallback,
      error: this.status.error
    };
  }
}
