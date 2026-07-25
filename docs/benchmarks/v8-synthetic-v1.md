# V8 synthetic-v1 benchmark

Measured 2026-07-25 with Node.js on the committed deterministic synthetic/adversarial suite, both 44.1/48 kHz and fast/browser-like execution. Scores below use the primary fast run; all fast/browser event streams were exactly equivalent.

| Detector | F1 @25 ms | F1 @50 ms | Precision @50 | Recall @50 | Class macro F1 | FP/min |
|---|---:|---:|---:|---:|---:|---:|
| current-baseline | 0.499 | 0.499 | 0.387 | 0.700 | 0.473 | 106.7 |
| spectral-flux-baseline | 0.622 | 0.622 | 0.620 | 0.625 | 0.573 | 36.9 |
| v8-flux-v1 | 0.700 | 0.700 | 0.613 | 0.817 | 0.533 | 49.7 |
| v8-multiband-v1 | **0.852** | **0.852** | **0.839** | **0.867** | 0.699 | **16.0** |
| v8-robust-v1 | 0.776 | 0.776 | 0.746 | 0.808 | **0.772** | 26.5 |

Directional Node runtime for browser-like 128-sample blocks:

| Detector | Mean ms/128 (44.1k) | p95 file-block ms (44.1k) | Mean ms/128 (48k) | p95 file-block ms (48k) |
|---|---:|---:|---:|---:|
| current-baseline | 0.265 | 1.352 | 0.230 | 0.867 |
| spectral-flux-baseline | 0.607 | 1.778 | 0.684 | 1.567 |
| v8-flux-v1 | 0.309 | 0.948 | 0.313 | 0.700 |
| v8-multiband-v1 | 0.664 | 1.777 | 0.739 | 2.656 |
| v8-robust-v1 | 0.328 | 1.021 | 0.329 | 1.159 |

These timings include Node allocation/GC and structured clone. They are directional and must not be presented as browser-device performance. Run artifact directories were:

- `runs/2026-07-25T210121-727Z_current-baseline_bed4a55d4b1f`
- `runs/2026-07-25T210056-440Z_spectral-flux-baseline_20d9ce039c0b`
- `runs/2026-07-25T210144-059Z_v8-flux-v1_d24396f0e151`
- `runs/2026-07-25T210059-357Z_v8-multiband-v1_2a1eeb566268`
- `runs/2026-07-25T210212-040Z_v8-robust-v1_91c46f0d2bff`
