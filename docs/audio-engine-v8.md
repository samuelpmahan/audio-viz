# Audio Engine V8 Lab

V8 is an experimental, removable pipeline beside the unchanged `audio-engine-v7.js`. The normal URL still loads V7. Add `?engine=v8` to load V8; add `&debug=1` or press **Shift+D** to show the lab panel.

## Run

Serve the repository (AudioWorklet modules require HTTP):

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4173/index.html?engine=v8&debug=1
```

Example fully specified configuration:

```text
?engine=v8&analysis=worklet-robust&normalization=fast-slow-envelope&classifier=band-dominance&rhythm=phase-follower&lfoClock=phase-follower&latency=base-latency
```

Query parameters override `audioViz.v8.config` in `localStorage`. Invalid values fall back independently. `offset` selects the manual timing offset in milliseconds and `bpm` selects fixed BPM.

## Pipeline and modes

`SequentialAnalysisCore` consumes contiguous causal blocks and emits audio-clock frames. The AudioWorklet is the normal V8 backend; a ScriptProcessor fallback is exposed as a fallback state. `AnalyserNode` remains only for visualizers that draw the raw byte spectrum.

The independently switchable stages are:

- analysis: `v7`, `worklet-flux`, `worklet-multiband`, `worklet-robust`;
- normalization: `v7-peak`, `fast-slow-envelope`, `robust-percentile`, `off`;
- transient interpretation: `centroid`, `band-dominance`, `probabilistic`, `simultaneous`;
- rhythm: `v7-interval-average`, `interval-median`, `tempo-candidates`, `phase-follower`, `off`;
- modulation clock: `v7-bpm`, `phase-follower`, `fixed`, `free-running`, `disabled`;
- timing: `none`, `base-latency`, `output-latency`, `manual-offset`.

The V7 preset inside the lab is a dependency-free worklet approximation for live A/B switching. `?engine=v7` remains the literal unchanged V7 runtime control.

Low/high events are signal-domain transient labels, not semantic drum classification. Only the compatibility adapter maps low to `isKick` and high to `isSnare`.

## Presets

- Recommended default: `rhythm-heavy` — robust detector, fast/slow normalization, band dominance, confidence-gated phase follower.
- `expressive` — independent multiband/simultaneous events and more reactive free-running modulation.
- `low-latency` — 512/128 global flux with the shortest refractory period.
- `high-precision` — robust-percentile movement and output-latency compensation where supported.
- `minimal DSP` — global flux, raw levels, no rhythm or modulation.
- `V7 baseline` — compatibility settings.

Latency compensation is deliberately a comparison variable. `outputLatency` is not available on every browser/device and manual offset is clamped to ±500 ms.

## Local prerecorded input

Open the panel, select a local audio file, and use **Replay file** for repeated comparisons. Decoding happens with `decodeAudioData`; no upload or server storage occurs. Selecting the microphone or replaying the file resets all state. Do not commit external audio.

## Evaluation

```bash
npm test
npm run benchmark:smoke
node eval/cli.js --suite synthetic --detector v8-flux-v1
node eval/cli.js --suite synthetic --detector v8-multiband-v1
node eval/cli.js --suite synthetic --detector v8-robust-v1
```

`v8-browser-benchmark.html` runs a generated 10-second signal through the actual Chromium AudioWorklet, changes five presets, and reports main-thread, memory, latency, and error state. Browser AudioWorklet CPU mean/p95 are reported only when its global scope exposes a high-resolution wall clock; Chromium 150 did not, so the committed report marks those values unavailable instead of substituting Node timings.

See [the synthetic benchmark report](benchmarks/v8-synthetic-v1.md), [the Chromium report](benchmarks/v8-browser-chromium-v1.json), and [the experiment log](../EXPERIMENTS-V8.md).
