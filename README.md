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
