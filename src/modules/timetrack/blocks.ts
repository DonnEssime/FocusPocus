import { pmapDelete, pmapEmpty, pmapGet, pmapSet, type PMap } from '../../core/pmap';

/** A tracked interval. `endMs === null` means it is running. Times are UTC epoch ms. */
export interface Block {
  /** Id of the command that created the block. */
  id: string;
  startMs: number;
  endMs: number | null;
  /** Empty means "show the default title". */
  title: string;
  tagIds: readonly string[];
}

/**
 * Blocks sorted by `(startMs, id)`, in buckets of a fixed time span: `keys[i]` is the bucket key of
 * the non-empty list `lists[i]`, ascending. A command copies only the buckets it touches (plus the
 * two small arrays), and a range query reads only the buckets around the range.
 */
export interface BlockIndex {
  readonly keys: readonly number[];
  readonly lists: readonly (readonly Block[])[];
  /** Block id → bucket key. */
  readonly where: PMap<number>;
}

/** About 12.4 days: a bucket holds a few dozen blocks, and ten years need about 300 buckets. */
const BUCKET_MS = 2 ** 30;

const bucketOf = (ms: number) => Math.floor(ms / BUCKET_MS);

export const EMPTY_INDEX: BlockIndex = { keys: [], lists: [], where: pmapEmpty() };

/** Total order of blocks: by start, then by id (ids are unique). */
function before(aStart: number, aId: string, bStart: number, bId: string): boolean {
  return aStart < bStart || (aStart === bStart && aId < bId);
}

/** Index of the first key `>= k` in a sorted array. */
function lowerBound(keys: readonly number[], k: number): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]! < k) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The end used for overlap rules and totals: a running block ends at `now` (never before its start). */
export function effectiveEnd(block: Block, now: number): number {
  return block.endMs ?? Math.max(now, block.startMs);
}

export function getBlock(index: BlockIndex, id: string): Block | undefined {
  const key = pmapGet(index.where, id);
  if (key === undefined) return undefined;
  return index.lists[lowerBound(index.keys, key)]?.find((b) => b.id === id);
}

export function blockCount(index: BlockIndex): number {
  return index.where.size;
}

/** The last block ordered before `(startMs, id)`. */
function prevBlock(index: BlockIndex, startMs: number, id: string): Block | undefined {
  for (let i = lowerBound(index.keys, bucketOf(startMs) + 1) - 1; i >= 0; i--) {
    const bucket = index.lists[i]!;
    for (let j = bucket.length - 1; j >= 0; j--) {
      const b = bucket[j]!;
      if (before(b.startMs, b.id, startMs, id)) return b;
    }
  }
  return undefined;
}

/** Blocks ordered after `(startMs, id)`, lazily. An empty `id` sorts first, so it means "from `startMs` on". */
function* blocksAfter(index: BlockIndex, startMs: number, id: string): Generator<Block> {
  for (let i = lowerBound(index.keys, bucketOf(startMs)); i < index.keys.length; i++) {
    for (const b of index.lists[i]!) {
      if (before(startMs, id, b.startMs, b.id)) yield b;
    }
  }
}

/** Blocks overlapping `[from, to)`, in order. Reads only the buckets around the range. */
export function blocksInRange(index: BlockIndex, from: number, to: number, now: number): Block[] {
  const out: Block[] = [];
  // Blocks never overlap, so at most one block that starts before `from` can reach into the range.
  const prev = prevBlock(index, from, '');
  if (prev && effectiveEnd(prev, now) > from) out.push(prev);
  for (const b of blocksAfter(index, from, '')) {
    if (b.startMs >= to) break;
    out.push(b);
  }
  return out;
}

/** The neighbours a block may grow to without overlapping (used to clamp resizing). */
export function neighbours(index: BlockIndex, block: Block): { prev?: Block; next?: Block } {
  const prev = prevBlock(index, block.startMs, block.id);
  const next = blocksAfter(index, block.startMs, block.id).next().value ?? undefined;
  return { ...(prev ? { prev } : {}), ...(next ? { next } : {}) };
}

export function* allBlocks(index: BlockIndex): Generator<Block> {
  for (const list of index.lists) yield* list;
}

/**
 * A copy-on-write editor for one command's changes. The arrays are copied on the first change and
 * each bucket at most once, so a command costs about the size of the buckets it touches.
 */
export class IndexDraft {
  private keys: number[] | null = null;
  private lists: (readonly Block[])[] | null = null;
  private where: PMap<number>;
  /** Buckets already copied by this draft (safe to mutate in place). */
  private readonly owned = new Set<readonly Block[]>();

  constructor(private readonly base: BlockIndex) {
    this.where = base.where;
  }

  /** The current (draft) view, for queries in between edits. */
  view(): BlockIndex {
    return { keys: this.keys ?? this.base.keys, lists: this.lists ?? this.base.lists, where: this.where };
  }

  get(id: string): Block | undefined {
    return getBlock(this.view(), id);
  }

  private own(): { keys: number[]; lists: (readonly Block[])[] } {
    this.keys ??= this.base.keys.slice();
    this.lists ??= this.base.lists.slice();
    return { keys: this.keys, lists: this.lists };
  }

  /** The bucket for `key` as a mutable array, created when missing. */
  private mutable(key: number): Block[] {
    const { keys, lists } = this.own();
    const i = lowerBound(keys, key);
    if (keys[i] !== key) {
      const fresh: Block[] = [];
      keys.splice(i, 0, key);
      lists.splice(i, 0, fresh);
      this.owned.add(fresh);
      return fresh;
    }
    let bucket = lists[i]!;
    if (!this.owned.has(bucket)) {
      bucket = bucket.slice();
      lists[i] = bucket;
      this.owned.add(bucket);
    }
    return bucket as Block[];
  }

  remove(id: string): Block | undefined {
    const key = pmapGet(this.where, id);
    if (key === undefined) return undefined;
    const bucket = this.mutable(key);
    const [removed] = bucket.splice(bucket.findIndex((b) => b.id === id), 1);
    this.where = pmapDelete(this.where, id);
    if (bucket.length === 0) {
      const { keys, lists } = this.own();
      const i = lowerBound(keys, key);
      keys.splice(i, 1);
      lists.splice(i, 1);
    }
    return removed;
  }

  /** Inserts a block, or replaces the block with the same id (moving it if its start changed). */
  put(block: Block): void {
    if (pmapGet(this.where, block.id) !== undefined) this.remove(block.id);
    const key = bucketOf(block.startMs);
    const bucket = this.mutable(key);
    let i = bucket.length;
    while (i > 0 && before(block.startMs, block.id, bucket[i - 1]!.startMs, bucket[i - 1]!.id)) i--;
    bucket.splice(i, 0, block);
    this.where = pmapSet(this.where, block.id, key);
  }

  prev(block: Block): Block | undefined {
    return prevBlock(this.view(), block.startMs, block.id);
  }

  next(block: Block): Block | undefined {
    return blocksAfter(this.view(), block.startMs, block.id).next().value ?? undefined;
  }

  finish(): BlockIndex {
    return this.view();
  }
}

export type SettleResult = { ok: true; removed: string[] } | { ok: false };

/**
 * Applies the overlap rule (§10.2) around `subject`, which is already in the draft: of two
 * overlapping blocks, the one that starts later is truncated to start where the other ends, and
 * removed when that leaves nothing. Fails when the subject itself would be removed, so a command
 * never silently does nothing. `now` is the applying command's timestamp.
 *
 * Besides the direct predecessor, the running block counts as a predecessor too: it may have grown
 * past blocks that were created ahead of it, and those are only truncated when it stops.
 */
export function settleOverlaps(
  draft: IndexDraft,
  subjectId: string,
  runningId: string | null,
  now: number,
): SettleResult {
  let subject = draft.get(subjectId)!;
  const running = runningId && runningId !== subjectId ? draft.get(runningId) : undefined;
  // Moving the start past one predecessor can land it inside the next one, so repeat until stable.
  for (;;) {
    let start = subject.startMs;
    for (const p of [draft.prev(subject), running]) {
      if (p && before(p.startMs, p.id, subject.startMs, subject.id)) start = Math.max(start, effectiveEnd(p, now));
    }
    if (start <= subject.startMs) break;
    // Fully covered, or a running block that would start in the future.
    if (subject.endMs !== null ? start >= subject.endMs : start > now) return { ok: false };
    subject = { ...subject, startMs: start };
    draft.put(subject);
  }
  const removed: string[] = [];
  const end = effectiveEnd(subject, now);
  for (let next = draft.next(subject); next && next.startMs < end; next = draft.next(subject)) {
    if (effectiveEnd(next, now) <= end) {
      draft.remove(next.id);
      removed.push(next.id);
    } else {
      draft.put({ ...next, startMs: end });
      break;
    }
  }
  return { ok: true, removed };
}
