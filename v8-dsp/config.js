import { ANALYSIS_MODES } from './analysis-core.js';
import { NORMALIZATION_MODES } from './normalization.js';
import { CLASSIFIER_MODES } from './transients.js';
import { RHYTHM_MODES } from './rhythm.js';
import { LATENCY_MODES, LFO_CLOCKS, LOW_CONFIDENCE_BEHAVIORS } from './presentation.js';

export const STORAGE_KEY = 'audioViz.v8.config';

export const DEFAULT_CONFIG = Object.freeze({
  analysis: 'worklet-robust',
  normalization: 'fast-slow-envelope',
  classifier: 'band-dominance',
  rhythm: 'phase-follower',
  lfoClock: 'phase-follower',
  lowConfidence: 'reduce-depth',
  latency: 'base-latency',
  manualOffsetMs: 0,
  fixedBpm: 120
});

export const CONFIG_OPTIONS = Object.freeze({
  analysis: ANALYSIS_MODES,
  normalization: NORMALIZATION_MODES,
  classifier: CLASSIFIER_MODES,
  rhythm: RHYTHM_MODES,
  lfoClock: LFO_CLOCKS,
  lowConfidence: LOW_CONFIDENCE_BEHAVIORS,
  latency: LATENCY_MODES
});

export const PRESETS = Object.freeze({
  'V7-shaped worklet baseline': { analysis: 'v7', normalization: 'v7-peak', classifier: 'centroid', rhythm: 'v7-interval-average', lfoClock: 'v7-bpm', lowConfidence: 'hold', latency: 'none' },
  'low-latency': { analysis: 'worklet-flux', normalization: 'fast-slow-envelope', classifier: 'centroid', rhythm: 'interval-median', lfoClock: 'free-running', lowConfidence: 'free-running', latency: 'none' },
  'high-precision': { analysis: 'worklet-robust', normalization: 'robust-percentile', classifier: 'band-dominance', rhythm: 'phase-follower', lfoClock: 'phase-follower', lowConfidence: 'reduce-depth', latency: 'output-latency' },
  expressive: { analysis: 'worklet-multiband', normalization: 'fast-slow-envelope', classifier: 'simultaneous', rhythm: 'tempo-candidates', lfoClock: 'free-running', lowConfidence: 'free-running', latency: 'base-latency' },
  'rhythm-heavy': { analysis: 'worklet-robust', normalization: 'fast-slow-envelope', classifier: 'band-dominance', rhythm: 'phase-follower', lfoClock: 'phase-follower', lowConfidence: 'reduce-depth', latency: 'base-latency' },
  'minimal DSP': { analysis: 'worklet-flux', normalization: 'off', classifier: 'centroid', rhythm: 'off', lfoClock: 'disabled', lowConfidence: 'disable', latency: 'none' }
});

function finiteNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export function validateConfig(input = {}) {
  const config = { ...DEFAULT_CONFIG };
  for (const [key, values] of Object.entries(CONFIG_OPTIONS)) if (values.includes(input[key])) config[key] = input[key];
  config.manualOffsetMs = finiteNumber(input.manualOffsetMs, DEFAULT_CONFIG.manualOffsetMs, -500, 500);
  config.fixedBpm = finiteNumber(input.fixedBpm, DEFAULT_CONFIG.fixedBpm, 30, 300);
  return config;
}

export function parseConfig({ search = '', stored = null } = {}) {
  let persisted = {};
  try { persisted = stored ? JSON.parse(stored) : {}; } catch { persisted = {}; }
  const params = new URLSearchParams(search);
  const query = {};
  for (const key of Object.keys(CONFIG_OPTIONS)) if (params.has(key)) query[key] = params.get(key);
  if (params.has('offset')) query.manualOffsetMs = params.get('offset');
  if (params.has('bpm')) query.fixedBpm = params.get('bpm');
  return validateConfig({ ...persisted, ...query });
}

export function browserConfig() {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* storage may be unavailable */ }
  return parseConfig({ search: location.search, stored });
}

export function persistConfig(config) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(validateConfig(config))); } catch { /* storage may be unavailable */ }
}
