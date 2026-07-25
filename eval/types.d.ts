export type TransientClass = 'lowTransient' | 'highTransient';

export interface DetectorConfig {
  readonly windowSize?: number;
  readonly hopSize?: number;
  readonly [key: string]: unknown;
}

export interface BlockMetadata {
  readonly sampleRate: number;
  readonly frameStartSample: number;
  readonly contextTimeSec: number;
}

export interface DetectorEvent {
  readonly sample: number;
  readonly timeSec: number;
  readonly detectedAtSec: number;
  readonly class: TransientClass;
  readonly score: number;
}

export interface DetectorFrame {
  readonly sample: number;
  readonly timeSec: number;
  readonly level: number;
  readonly normalizedLevel?: number;
  readonly diagnostics?: Readonly<Record<string, unknown>>;
  // Reserved, unscored extension fields for future campaigns:
  readonly tempoBpm?: number;
  readonly beatPhase?: number;
  readonly downbeatProbability?: number;
  readonly sectionBoundaryProbability?: number;
}

export interface DetectorOutput {
  readonly frames: readonly DetectorFrame[];
  readonly events: readonly DetectorEvent[];
  readonly diagnostics?: Readonly<Record<string, unknown>>;
}

export interface StreamingDetector {
  initialize(config: DetectorConfig): void;
  reset(): void;
  process(samples: Float32Array, metadata: BlockMetadata): DetectorOutput;
}
