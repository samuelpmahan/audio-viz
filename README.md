# audio-viz

The existing browser visualizer remains a static application. Serve this directory with any static HTTP server and open `index.html`; its import map continues to load Meyda in the browser and no build step is required.

## Deterministic DSP evaluation

The repository also contains an algorithm-neutral, causal streaming evaluation harness. It is intentionally separate from the visualizer and requires Node.js 20 or newer.

```bash
npm test
npm run benchmark:smoke
npm run benchmark:synthetic
npm run benchmark:browser
npm run benchmark -- --detector current-baseline
npm run benchmark -- --detector spectral-flux-baseline
```

Smoke and synthetic benchmarks generate their own deterministic audio and require no downloads. Results are written to unique, read-only `runs/` directories, which Git ignores. See [eval/README.md](eval/README.md) for architecture, scoring, replay, and limitations, and [eval/datasets/README.md](eval/datasets/README.md) for optional corpora.

## Experimental Audio Engine V8

The unchanged V7 engine remains the parameterless default. Top-level engine selection is URL-only: use `?engine=v7` for actual V7 or `?engine=v8` for actual V8. Add `&debug=1` or press **Shift+D** for V8 controls. The panel labels page-reload engine switching separately from live V8 subsystem switching. V8 includes local-only prerecorded playback, independently switchable analysis/normalization/transient/rhythm/timing stages, and a V7-compatible metrics adapter.

See [docs/audio-engine-v8.md](docs/audio-engine-v8.md) for configuration, presets, benchmark commands, limitations, and browser measurement details.
