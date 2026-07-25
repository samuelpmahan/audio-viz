import { CONFIG_OPTIONS, PRESETS } from './v8-dsp/config.js';
import { engineReloadUrl } from './v8-dsp/engine-selection.js';

const LABELS = {
  analysis: 'Analysis backend', normalization: 'Normalization', classifier: 'Transient interpretation', rhythm: 'Rhythm mode',
  lfoClock: 'LFO clock', lowConfidence: 'Low-confidence behavior', latency: 'Timing compensation'
};

export function installV8DebugPanel(engine) {
  const style = document.createElement('style');
  style.textContent = `
    #audio-v8-lab{position:fixed;z-index:10000;right:14px;top:14px;width:min(430px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;background:rgba(5,8,14,.96);color:#d8f8ff;border:1px solid #23c9ff66;border-radius:10px;padding:14px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 12px 44px #000b;display:none}
    #audio-v8-lab.open{display:block} #audio-v8-lab h2{margin:0 0 4px;color:#64e5ff;font-size:15px} #audio-v8-lab p{margin:0 0 10px;color:#78909c}
    #audio-v8-lab .grid{display:grid;grid-template-columns:1fr 1fr;gap:7px} #audio-v8-lab label{display:flex;flex-direction:column;gap:3px;color:#94a9b2}
    #audio-v8-lab select,#audio-v8-lab input,#audio-v8-lab button{font:inherit;color:#e9fbff;background:#111b25;border:1px solid #294454;border-radius:4px;padding:5px}
    #audio-v8-lab .presets{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0} #audio-v8-lab button{cursor:pointer} #audio-v8-lab button:hover{border-color:#41d9ff}
    #audio-v8-lab .engine-reloads{display:flex;gap:6px;margin:7px 0 12px} #audio-v8-lab .section-label{margin:9px 0 4px;color:#64e5ff;font-weight:700}
    #audio-v8-lab pre{white-space:pre-wrap;background:#081018;border-radius:5px;padding:8px;margin:8px 0 0;color:#b7dce6;font-size:11px} #audio-v8-lab .close{float:right;border:0;background:none;font-size:16px;padding:0 3px}
    #audio-v8-lab .source{display:flex;gap:5px;align-items:center;margin-top:9px} #audio-v8-lab .source input{min-width:0;flex:1}
  `;
  document.head.appendChild(style);
  const panel = document.createElement('aside');
  panel.id = 'audio-v8-lab';
  panel.innerHTML = `<button class="close" title="Close">×</button><h2>Audio Engine V8 Lab</h2><p>Toggle with <kbd>Shift+D</kbd>.</p><div class="section-label">Top-level engine (page reload)</div><div class="engine-reloads"><button data-engine="v7">Actual V7 (reload)</button><button data-engine="v8">Actual V8 (reload)</button></div><div class="section-label">Live V8 subsystem switching</div><p>Controls and presets below reset V8 DSP state without changing the loaded engine module.</p><div class="grid"></div><div class="presets"></div><div class="source"><input type="file" accept="audio/*"><button data-action="replay">Replay file</button><button data-action="mic">Mic</button></div><pre data-role="status"></pre>`;
  document.body.appendChild(panel);
  for (const button of panel.querySelectorAll('[data-engine]')) button.addEventListener('click', () => location.assign(engineReloadUrl(location.href, button.dataset.engine)));
  const grid = panel.querySelector('.grid');
  for (const [key, options] of Object.entries(CONFIG_OPTIONS)) {
    const label = document.createElement('label');
    label.textContent = LABELS[key];
    const select = document.createElement('select');
    select.dataset.key = key;
    select.innerHTML = options.map((option) => `<option value="${option}">${option}</option>`).join('');
    select.value = engine.config[key];
    select.addEventListener('change', () => engine.setConfig({ [key]: select.value }));
    label.appendChild(select);
    grid.appendChild(label);
  }
  for (const [key, labelText, minimum, maximum, step] of [['manualOffsetMs', 'Manual offset (ms)', -500, 500, 1], ['fixedBpm', 'Fixed BPM', 30, 300, 1]]) {
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input'); input.type = 'number'; input.min = minimum; input.max = maximum; input.step = step; input.value = engine.config[key];
    input.addEventListener('change', () => engine.setConfig({ [key]: Number(input.value) })); label.appendChild(input); grid.appendChild(label);
  }
  const presets = panel.querySelector('.presets');
  for (const [name, config] of Object.entries(PRESETS)) {
    const button = document.createElement('button'); button.textContent = name; button.addEventListener('click', () => engine.setConfig(config)); presets.appendChild(button);
  }
  panel.querySelector('.close').addEventListener('click', () => panel.classList.remove('open'));
  panel.querySelector('input[type=file]').addEventListener('change', (event) => engine.loadAudioFile(event.target.files[0]).catch((error) => { engine.status.error = error.message; }));
  panel.querySelector('[data-action=replay]').addEventListener('click', () => engine.replayFile().catch((error) => { engine.status.error = error.message; }));
  panel.querySelector('[data-action=mic]').addEventListener('click', () => engine.useMicrophone().catch((error) => { engine.status.error = error.message; }));
  const syncControls = () => {
    for (const input of panel.querySelectorAll('[data-key]')) input.value = engine.config[input.dataset.key];
    const numbers = panel.querySelectorAll('input[type=number]'); numbers[0].value = engine.config.manualOffsetMs; numbers[1].value = engine.config.fixedBpm;
  };
  engine.onConfigurationChange(syncControls);
  const toggle = () => panel.classList.toggle('open');
  document.addEventListener('keydown', (event) => { if (event.shiftKey && event.key.toLowerCase() === 'd') toggle(); });
  window.audioV8 = Object.freeze({ engine, toggleDebug: toggle, presets: PRESETS });
  if (new URLSearchParams(location.search).get('debug') === '1') panel.classList.add('open');
  const status = panel.querySelector('[data-role=status]');
  const render = () => {
    const state = engine.getDebugState();
    const m = state.metrics;
    status.textContent = [
      `${state.sampleRate} Hz · ${state.processingMode} · ${state.sourceKind ?? 'no source'}`,
      `onset G ${fmt(m.globalOnset)}  L ${fmt(m.lowOnset)}  M ${fmt(m.midOnset)}  H ${fmt(m.highOnset)}`,
      `bands  L ${fmt(m.bass)}  M ${fmt(m.mid)}  H ${fmt(m.treble)}  level ${fmt(m.normalizedLevel)}`,
      `rhythm ${m.bpm || '--'} BPM  conf ${fmt(m.rhythmConfidence)}  phase ${fmt(m.beatPhase)}`,
      state.processingClockAvailable ? `processing mean ${fmt(m.analysisProcessingMeanMs, 3)} ms  p95 ${fmt(m.analysisProcessingP95Ms, 3)} ms / 128` : 'processing timing unavailable in this AudioWorkletGlobalScope',
      `latency base ${fmt(state.latency.baseLatency * 1000, 1)} ms  output ${fmt(state.latency.outputLatency * 1000, 1)} ms  applied ${fmt(state.latency.appliedMs, 1)} ms`,
      `presentation queue ${state.presentation.depth}  oldest lateness ${fmt(state.presentation.oldestFrameLatenessMs, 1)} ms`,
      `events ${state.recentEvents.slice(0, 6).map((event) => `${event.band}@${event.timeSec.toFixed(3)}`).join('  ') || 'none'}`,
      state.fallback ? `FALLBACK: ${state.fallback}` : 'fallback: none',
      state.error ? `ERROR: ${state.error}` : 'error: none'
    ].join('\n');
    requestAnimationFrame(render);
  };
  render();
  return { panel, toggle };
}

function fmt(value, digits = 2) { return Number.isFinite(value) ? value.toFixed(digits) : '--'; }
