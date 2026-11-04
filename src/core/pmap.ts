/**
 * A tiny persistent (immutable) string-keyed map for module state.
 *
 * Module state must never be mutated, because the runner keeps old states as checkpoints. A plain
 * object copied on every change costs O(n) per command, which adds up to O(n²) on a full replay.
 * This map splits its keys over a fixed number of shards by hash, so a change copies one shard (a
 * few dozen keys at 40k entries) and the shard array (a fast pointer copy).
 *
 * Plain arrays and objects only, so states stay structurally comparable and serialisable.
 */
export interface PMap<V> {
  readonly size: number;
  readonly shards: readonly (Readonly<Record<string, V>> | undefined)[];
}

const SHARDS = 1024;

function shardOf(key: string): number {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % SHARDS;
}

export function pmapEmpty<V>(): PMap<V> {
  return { size: 0, shards: [] };
}

export function pmapGet<V>(map: PMap<V>, key: string): V | undefined {
  const shard = map.shards[shardOf(key)];
  return shard && Object.hasOwn(shard, key) ? shard[key] : undefined;
}

export function pmapHas(map: PMap<unknown>, key: string): boolean {
  const shard = map.shards[shardOf(key)];
  return !!shard && Object.hasOwn(shard, key);
}

export function pmapSet<V>(map: PMap<V>, key: string, value: V): PMap<V> {
  const i = shardOf(key);
  const shard = map.shards[i];
  const had = !!shard && Object.hasOwn(shard, key);
  if (had && shard[key] === value) return map;
  const shards = map.shards.slice();
  shards[i] = { ...shard, [key]: value };
  return { size: map.size + (had ? 0 : 1), shards };
}

export function pmapDelete<V>(map: PMap<V>, key: string): PMap<V> {
  const i = shardOf(key);
  const shard = map.shards[i];
  if (!shard || !Object.hasOwn(shard, key)) return map;
  const { [key]: _removed, ...rest } = shard;
  const shards = [...map.shards];
  shards[i] = rest;
  return { size: map.size - 1, shards };
}

export function* pmapEntries<V>(map: PMap<V>): Generator<[string, V]> {
  for (const shard of map.shards) {
    if (shard) yield* Object.entries(shard) as [string, V][];
  }
}
