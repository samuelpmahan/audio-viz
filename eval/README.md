# Deterministic DSP evaluation harness

## Architecture and causal boundary

Every candidate implements the small contract in `types.d.ts`: explicit initialization, reset, sequential `Float32Array` blocks, sample rate, sample index, audio-clock time, continuous frames, sparse events, and optional diagnostics. Tempo, beat phase, downbeat, and section-boundary fields are reserved extension points and are not populated or scored.

Both runners use 128-sample blocks. Fast mode executes synchronously without wall-clock throttling. Browser-realistic mode uses the same blocks and structured-clones detector outputs to model a worklet/message boundary. Each input block owns an exact-sized `ArrayBuffer`; a detector never receives the complete file or a view into future samples. Outputs may timestamp an onset already observed in a buffered analysis window, but an event's sample and detection time cannot be in the future.

This is a Node simulation of AudioWorklet constraints, not a claim of measured Chrome, Safari, mobile, or production AudioWorklet performance. A later browser runner should execute this same contract in an actual `AudioWorkletProcessor`.

## Fixed versioned baselines

Baseline defaults are immutable objects and versions are recorded in every run:

| ID | Version | Purpose |
| --- | --- | --- |
| `current-baseline` | 1.0.0 | Approximation of the current 2048-bin analyser smoothing, absolute byte-spectrum change, adaptive threshold, centroid split, and cooldowns. Browser analyser dB conversion and RAF scheduling are approximated deterministically. |
| `spectral-flux-baseline` | 1.0.0 | Half-wave-rectified spectral flux with a causal adaptive threshold. |
| `multiband-energy-baseline` | 1.0.0 | Independent low/high spectral-band energy differences; can emit simultaneous labels. |
| `meyda-feature-baseline` | 1.0.0 | Streaming RMS-rise and spectral-centroid feature baseline matching the existing Meyda feature strategy. |

The actual Meyda package is browser-loaded by the visualizer's import map. It is not installed in Node because doing so would add a network-installed runtime dependency and can vary feature implementations across package versions. The fixed feature-equivalent baseline makes this blocker explicit while keeping clean-checkout benchmarks deterministic. A future baseline can vendor or integrity-pin a specific Meyda release and bump the baseline version.

Intentionally bad detectors include no events, fixed-period events, every active block classified low or high, silence-boundary events, and duplicate events. They are test controls, not leaderboard candidates.

## Metrics

Onsets use deterministic dynamic-programming matching that maximizes one-to-one matches, then correct-class matches, then minimizes total timing error. Reports include precision/recall/F1 at ±25 ms and ±50 ms, median and p95 absolute error, signed bias, false positives/minute, misses, and duplicate triggers. Classification reports per-class precision/recall, macro F1, a confusion matrix, simultaneous events, isolated subsets, and full-mix subsets. The semantic labels are deliberately `lowTransient` and `highTransient`, not kick and snare.

Level reports expose causal peak-normalized attack, release, level-change recovery, overshoot, noise floor, steady-state variation, and clipping-frame behavior for applicable synthetic cases. Runtime accuracy is never combined with algorithm accuracy. Timing and Node heap deltas are environment-dependent; every sample rate and execution mode is separate.

## Synthetic diagnostics

`synthetic-v1` deterministically generates exact sample-index annotations at 44.1 and 48 kHz for isolated impulses, low bursts, high noise bursts, alternating and simultaneous events, close doubles, regular trains, tempo ramps, silence transitions, abrupt level drops, steady tones, bass-like and bright non-percussive attacks, clipping, noise, and reverb tails. PCM SHA-256 checksums appear in per-file results.

## Runs and replay

Each benchmark creates a new `runs/<timestamp>_<detector>_<config-hash>/` and refuses to overwrite a collision. It records configuration, detector/version, manifest and split versions, Git SHA, environment, seed, summaries, per-file CSV, JSONL timelines, SVG charts, runtime data, and ranked failures. Restricted datasets are referenced by local ID and timestamp; audio is never copied. Private-holdout mode redacts timelines and exposes only aggregate metrics through `aggregatePrivateHoldout`.

The checked-in `baselines/synthetic-v1-reference.json` captures deterministic accuracy results for the established baseline versions. Runtime is deliberately omitted from that reference because it is host-dependent.

Replay the command from `config.json`. Accuracy, checksums, events, splits, and summaries are reproducible. Startup, runtime, allocation, memory, host metadata, and run timestamp are explicitly environment-dependent.

## Known weaknesses and gaming risks

- Synthetic timbres are diagnostic rather than a substitute for diverse recorded music.
- The current baseline can only approximate `AnalyserNode` dB quantization and RAF scheduling outside a browser.
- Node heap deltas are noisy and do not isolate detector allocation; actual worklet allocation tracing is still needed.
- A detector could memorize public synthetic fixture timing or identify fixture fingerprints.
- Aggregate F1 can hide performer, session, dynamic-range, and genre failures.
- The fixed tolerance windows can reward systematic delayed triggers just inside 50 ms.
- A classifier can exploit synthetic frequency separation rather than learn robust transient evidence.
- Unclassified onset-only corpora contribute to onset scoring but are excluded from low/high metrics.

Adversarial review should add unseen seeded waveform variants, polarity and gain changes, resampling, codec artifacts, phase changes, denormals, long silence, dense polyphony, real browser scheduling, and a separately administered private holdout. Review per-file failures and sample-rate gaps, not only aggregate rankings. Keep private labels inaccessible to optimizing agents.

The smallest next DSP task is to add one new, versioned causal candidate implementing half-wave spectral flux plus robust local thresholding, without changing fixtures or baseline configs, then compare it on development and adversarial partitions only.
