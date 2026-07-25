import { createHash } from 'node:crypto';

export const SPLIT_VERSION = 'grouped-v1';
export const DEFAULT_SPLIT_SEED = 20260117;

function unitInterval(seed, groupId) {
  const digest = createHash('sha256').update(`${seed}:${groupId}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

export function generateSplits(records, { seed = DEFAULT_SPLIT_SEED } = {}) {
  const partitions = { development: [], validation: [], privateHoldout: [], adversarial: [] };
  const assignment = new Map();
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  for (const record of sorted) {
    const groupId = record.groupId || record.sessionId || record.performerId || record.id;
    let partition = assignment.get(groupId);
    if (!partition) {
      if (record.tags?.includes('adversarial') || record.source === 'synthetic-v1') partition = 'adversarial';
      else {
        const value = unitInterval(seed, groupId);
        partition = value < 0.65 ? 'development' : value < 0.85 ? 'validation' : 'privateHoldout';
      }
      assignment.set(groupId, partition);
    }
    partitions[partition].push(record.id);
  }
  return Object.freeze({ version: SPLIT_VERSION, seed, strategy: 'performer/session/source-group hashing', partitions });
}

export function assertNoPartitionOverlap(split) {
  const seen = new Set();
  for (const [partition, ids] of Object.entries(split.partitions)) {
    for (const id of ids) {
      if (seen.has(id)) throw new Error(`Record ${id} occurs in more than one partition (including ${partition})`);
      seen.add(id);
    }
  }
  return true;
}
