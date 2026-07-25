export function inferTransientClass(label = '') {
  const normalized = label.toLowerCase();
  if (/kick|bass[ _-]?drum|\bbd\b|low/.test(normalized)) return 'lowTransient';
  if (/snare|hi[ _-]?hat|cymbal|clap|rim|high|\bsd\b/.test(normalized)) return 'highTransient';
  return 'unclassifiedTransient';
}

export function parseOnsetAnnotations(text, { sampleRate, defaultLabel = '' } = {}) {
  if (!sampleRate) throw new Error('sampleRate is required to create sample-exact annotations');
  const annotations = [];
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const columns = line.split(/[\s,;]+/);
    const timeSec = Number(columns[0]);
    if (!Number.isFinite(timeSec) || timeSec < 0) throw new Error(`Invalid annotation time on line ${lineIndex + 1}`);
    const sample = Math.round(timeSec * sampleRate);
    annotations.push({
      sample,
      timeSec: sample / sampleRate,
      class: inferTransientClass(columns.slice(1).join(' ') || defaultLabel),
      sourceLabel: columns.slice(1).join(' ') || defaultLabel || null
    });
  }
  return annotations.sort((a, b) => a.sample - b.sample || a.class.localeCompare(b.class));
}
