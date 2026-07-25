import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { parseOnsetAnnotations } from './annotations.js';
import { decodeWav } from './wav.js';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

async function checksum(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

const definitions = {
  enst: { displayName: 'ENST-Drums', license: 'Research dataset; obtain from the official distributor and follow its license.', grouping: 'performer/session inferred from parent directories' },
  idmt: { displayName: 'IDMT-SMT-Drums', license: 'Research dataset; obtain from Fraunhofer/official distributor and follow its terms.', grouping: 'performer/session inferred from parent directories' },
  onset_db: { displayName: 'onset_db-compatible', license: 'Annotations and audio can have separate licenses; audio is used only when locally and legally available.', grouping: 'source recording directory' }
};

export async function buildExternalManifest({ root, adapter, includeDecodedAudio = false }) {
  const definition = definitions[adapter];
  if (!definition) throw new Error(`Unknown adapter ${adapter}; expected ${Object.keys(definitions).join(', ')}`);
  try { await stat(root); } catch { throw new Error(`${definition.displayName} unavailable at ${root}. Set AUDIO_VIZ_DATA_DIR and follow eval/datasets/README.md.`); }
  const files = await walk(root);
  const audioFiles = files.filter((path) => extname(path).toLowerCase() === '.wav');
  const records = [];
  for (const audioPath of audioFiles) {
    const stem = audioPath.slice(0, -extname(audioPath).length);
    const annotationPath = files.find((path) => path.startsWith(stem) && ['.txt', '.onsets', '.csv'].includes(extname(path).toLowerCase()));
    if (!annotationPath) continue;
    const decoded = await decodeWav(audioPath);
    const relativeAudio = relative(root, audioPath);
    const parentParts = relative(root, dirname(audioPath)).split(/[\\/]/).filter(Boolean);
    const groupId = `${adapter}/${parentParts.slice(0, 2).join('/') || 'ungrouped'}`;
    const annotations = parseOnsetAnnotations(await readFile(annotationPath, 'utf8'), { sampleRate: decoded.sampleRate, defaultLabel: basename(audioPath) });
    records.push({
      id: `${adapter}/${relativeAudio}`,
      source: adapter,
      localAudioPath: audioPath,
      localAnnotationPath: annotationPath,
      sampleRate: decoded.sampleRate,
      durationSec: decoded.samples.length / decoded.sampleRate,
      checksum: await checksum(audioPath),
      annotationChecksum: await checksum(annotationPath),
      annotations,
      groupId,
      tags: [adapter, /mix/i.test(relativeAudio) ? 'full-mix' : 'isolated'],
      ...(includeDecodedAudio ? { samples: decoded.samples } : {})
    });
  }
  return {
    version: `${adapter}-local-v1`,
    adapter,
    displayName: definition.displayName,
    licenseNote: definition.license,
    grouping: definition.grouping,
    root,
    records: records.sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function externalDataRoot(environment = process.env) {
  if (!environment.AUDIO_VIZ_DATA_DIR) throw new Error('AUDIO_VIZ_DATA_DIR is not set; external corpora are optional and synthetic benchmarks remain available.');
  return environment.AUDIO_VIZ_DATA_DIR;
}
