const V8_QUERY_KEYS = Object.freeze([
  'analysis', 'normalization', 'classifier', 'rhythm', 'lfoClock',
  'lowConfidence', 'latency', 'offset', 'bpm', 'debug'
]);

export function selectTopLevelEngine(search = '') {
  const requested = new URLSearchParams(search).get('engine');
  const engine = requested === 'v8' ? 'v8' : 'v7';
  return {
    engine,
    modulePath: engine === 'v8' ? './audio-engine-v8.js' : './audio-engine-v7.js'
  };
}

export function engineReloadUrl(href, engine) {
  const url = new URL(href);
  if (engine === 'v8') {
    url.searchParams.set('engine', 'v8');
    url.searchParams.set('debug', '1');
  } else {
    url.searchParams.set('engine', 'v7');
    for (const key of V8_QUERY_KEYS) url.searchParams.delete(key);
  }
  return url.href;
}
