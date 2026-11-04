import type { Action } from '../../core/session';
import { applied, defineCommand, defineModule, rejected, type ApplyResult } from '../../core/module';
import { EMPTY_INDEX, getBlock, IndexDraft, settleOverlaps, type Block, type BlockIndex } from './blocks';
import { timetrackCatalog } from './catalog';
import {
  INITIAL_TARGETS,
  isDayKey,
  isDayTarget,
  isTargetMs,
  withDayTarget,
  withFulltime,
  type BalanceInterval,
  type DayTarget,
  type TargetsState,
} from './targets';

export type { Block, BlockIndex } from './blocks';
export type { BalanceInterval, DayTarget, TargetsState } from './targets';

/**
 * Visible part of a logical day, in whole local hours. `endHour <= startHour` means the end
 * falls on the next day; whole hours make a window longer than 24 h impossible. `startHour` is
 * also where a logical day begins.
 */
export interface DayWindow {
  startHour: number;
  endHour: number;
}

export interface Tag {
  /** Id of the command that created the tag. */
  id: string;
  name: string;
  /** Lowercase `#rrggbb`. User data, the same in every theme. */
  color: string;
  description: string;
  /** Tombstone: blocks keep the id but are shown and counted without it. */
  deleted: boolean;
}

export interface TimetrackState {
  dayWindow: DayWindow;
  blocks: BlockIndex;
  /** Id of the running block, if any. There is at most one. */
  runningId: string | null;
  tags: Readonly<Record<string, Tag>>;
  /** Tag ids in creation order (the order of the tags panel). */
  tagOrder: readonly string[];
  /** Target hours and the balance interval (§10.2 *Target hours*). */
  targets: TargetsState;
}

export const DEFAULT_DAY_WINDOW: DayWindow = { startHour: 7, endHour: 5 };

/** RColorBrewer Dark2. New tags get the least-used of the first seven; the grey is manual only. */
export const DARK2 = ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'] as const;
export const AUTO_TAG_COLORS = DARK2.slice(0, 7);

export const TITLE_MAX = 200;
export const TAG_NAME_MAX = 60;
export const TAG_DESCRIPTION_MAX = 500;

// ---------------------------------------------------------------------------------------------
// Payloads

export interface CreateBlockPayload {
  startMs: number;
  endMs: number;
  title: string;
  tagIds: string[];
}

export interface StartTrackingPayload {
  startMs: number;
  title: string;
  tagIds: string[];
}

export interface StopTrackingPayload {
  blockId: string;
  endMs: number;
}

export interface EditBlockPayload {
  blockId: string;
  title?: string;
  tagIds?: string[];
  startMs?: number;
  endMs?: number;
}

export interface BlockIdPayload {
  blockId: string;
}

export interface CreateTagPayload {
  name: string;
  color: string;
  description: string;
}

export interface EditTagPayload {
  tagId: string;
  name?: string;
  color?: string;
  description?: string;
}

export interface TagIdPayload {
  tagId: string;
}

export interface SetTargetSettingsPayload {
  enabled?: boolean;
  fulltimeMs?: number;
  /** With `fulltimeMs`: going forward from this day, or `null` = retroactively to all days. */
  applyFrom?: string | null;
}

export interface SetDayTargetPayload {
  day: string;
  /** `null` (or zero) = no target. */
  target: DayTarget | null;
}

export type SetBalanceIntervalPayload = BalanceInterval;

// ---------------------------------------------------------------------------------------------
// Validation

function isHour(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23;
}

function isTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isTitle(value: unknown): value is string {
  return typeof value === 'string' && value.length <= TITLE_MAX;
}

export function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isTagName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= TAG_NAME_MAX;
}

function isDescription(value: unknown): value is string {
  return typeof value === 'string' && value.length <= TAG_DESCRIPTION_MAX;
}

function liveTag(state: TimetrackState, id: unknown): Tag | undefined {
  const tag = typeof id === 'string' && Object.hasOwn(state.tags, id) ? state.tags[id] : undefined;
  return tag && !tag.deleted ? tag : undefined;
}

/** Validates a tag list: every tag must exist and be live. Returns the de-duplicated list. */
function checkTagIds(state: TimetrackState, tagIds: unknown): string[] | ApplyResult<TimetrackState> {
  if (!Array.isArray(tagIds)) return rejected('timetrack.error.invalidBlock');
  for (const id of tagIds) if (!liveTag(state, id)) return rejected('timetrack.error.noSuchTag');
  return [...new Set(tagIds as string[])];
}

const isFailure = (x: unknown): x is ApplyResult<TimetrackState> => !Array.isArray(x);

// ---------------------------------------------------------------------------------------------
// Block helpers

/**
 * Puts `block` into the index, applies the overlap rule around it and keeps `runningId` right.
 * Rejects when the block would be fully covered by an earlier one.
 */
function placeBlock(state: TimetrackState, draft: IndexDraft, block: Block, now: number): ApplyResult<TimetrackState> {
  draft.put(block);
  const settled = settleOverlaps(draft, block.id, state.runningId, now);
  if (!settled.ok) return rejected('timetrack.error.blockCovered');
  let runningId = state.runningId;
  if (block.endMs === null) runningId = block.id;
  else if (runningId === block.id) runningId = null;
  if (runningId && settled.removed.includes(runningId)) runningId = null;
  return applied({ ...state, blocks: draft.finish(), runningId });
}

const blockNotFound = () => rejected<TimetrackState>('timetrack.error.noSuchBlock');

// ---------------------------------------------------------------------------------------------
// Commands

const SetDayWindow = defineCommand<TimetrackState, DayWindow>({
  v: 1,
  undoable: true,
  apply(state, p) {
    if (!isHour(p?.startHour) || !isHour(p?.endHour)) return rejected('timetrack.error.invalidHour');
    return applied({ ...state, dayWindow: { startHour: p.startHour, endHour: p.endHour } });
  },
});

const CreateBlock = defineCommand<TimetrackState, CreateBlockPayload>({
  v: 1,
  undoable: true,
  apply(state, p, ctx) {
    if (!isTime(p?.startMs) || !isTime(p.endMs) || p.endMs <= p.startMs || !isTitle(p.title)) {
      return rejected('timetrack.error.invalidBlock');
    }
    const tagIds = checkTagIds(state, p.tagIds);
    if (isFailure(tagIds)) return tagIds;
    const block: Block = { id: ctx.id, startMs: p.startMs, endMs: p.endMs, title: p.title, tagIds };
    return placeBlock(state, new IndexDraft(state.blocks), block, ctx.at);
  },
});

/**
 * Starts a running block. Any block still running (another computer may have started one) ends
 * at this block's start first, so there is never more than one.
 */
const StartTracking = defineCommand<TimetrackState, StartTrackingPayload>({
  v: 1,
  undoable: true,
  apply(state, p, ctx) {
    if (!isTime(p?.startMs) || !isTitle(p.title)) return rejected('timetrack.error.invalidBlock');
    const tagIds = checkTagIds(state, p.tagIds);
    if (isFailure(tagIds)) return tagIds;
    const draft = new IndexDraft(state.blocks);
    let base = state;
    const other = state.runningId ? draft.get(state.runningId) : undefined;
    if (other) {
      if (p.startMs > other.startMs) {
        draft.put({ ...other, endMs: p.startMs });
        // It may have grown past blocks created ahead of it; the overlap rule applies now.
        settleOverlaps(draft, other.id, null, ctx.at);
      } else {
        draft.remove(other.id);
      }
      base = { ...state, runningId: null };
    }
    const block: Block = { id: ctx.id, startMs: p.startMs, endMs: null, title: p.title, tagIds };
    return placeBlock(base, draft, block, ctx.at);
  },
});

/**
 * Ends the running block. Stopping a block that is no longer running (another computer's Start
 * may have ended it) is a harmless no-op. A stop at or before the start removes the block.
 */
const StopTracking = defineCommand<TimetrackState, StopTrackingPayload>({
  v: 1,
  undoable: true,
  apply(state, p, ctx) {
    if (typeof p?.blockId !== 'string' || !isTime(p.endMs)) return rejected('timetrack.error.invalidBlock');
    const block = getBlock(state.blocks, p.blockId);
    if (!block) return blockNotFound();
    if (block.endMs !== null) return applied(state);
    const draft = new IndexDraft(state.blocks);
    if (p.endMs <= block.startMs) {
      draft.remove(block.id);
      return applied({ ...state, blocks: draft.finish(), runningId: null });
    }
    return placeBlock(state, draft, { ...block, endMs: p.endMs }, ctx.at);
  },
});

/** Changes only the fields given. Times come from resizing; a running block has no end to change. */
const EditBlock = defineCommand<TimetrackState, EditBlockPayload>({
  v: 1,
  undoable: true,
  apply(state, p, ctx) {
    if (typeof p?.blockId !== 'string') return rejected('timetrack.error.invalidBlock');
    const block = getBlock(state.blocks, p.blockId);
    if (!block) return blockNotFound();
    const { title, tagIds, startMs, endMs } = p;
    if (title === undefined && tagIds === undefined && startMs === undefined && endMs === undefined) {
      return rejected('timetrack.error.noChanges');
    }
    if (title !== undefined && !isTitle(title)) return rejected('timetrack.error.invalidBlock');
    if (startMs !== undefined && !isTime(startMs)) return rejected('timetrack.error.invalidBlock');
    if (endMs !== undefined && (!isTime(endMs) || block.endMs === null)) return rejected('timetrack.error.invalidBlock');
    let next: Block = { ...block };
    if (title !== undefined) next.title = title;
    if (tagIds !== undefined) {
      const checked = checkTagIds(state, tagIds);
      if (isFailure(checked)) return checked;
      next.tagIds = checked;
    }
    if (startMs !== undefined) next.startMs = startMs;
    if (endMs !== undefined) next.endMs = endMs;
    if (next.endMs !== null ? next.endMs <= next.startMs : next.startMs > ctx.at) {
      return rejected('timetrack.error.invalidBlock');
    }
    const draft = new IndexDraft(state.blocks);
    if (startMs === undefined && endMs === undefined) {
      draft.put(next);
      return applied({ ...state, blocks: draft.finish() });
    }
    return placeBlock(state, draft, next, ctx.at);
  },
});

/** Removes a block. For the running block this ends tracking without keeping a record. */
const DeleteBlock = defineCommand<TimetrackState, BlockIdPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    if (typeof p?.blockId !== 'string') return rejected('timetrack.error.invalidBlock');
    const draft = new IndexDraft(state.blocks);
    if (!draft.remove(p.blockId)) return blockNotFound();
    return applied({ ...state, blocks: draft.finish(), runningId: state.runningId === p.blockId ? null : state.runningId });
  },
});

/** Creates a tag. Name uniqueness is the UI's job: rejecting duplicates here would lose merged data. */
const CreateTag = defineCommand<TimetrackState, CreateTagPayload>({
  v: 1,
  undoable: true,
  apply(state, p, ctx) {
    if (!isTagName(p?.name) || !isColor(p.color) || !isDescription(p.description)) {
      return rejected('timetrack.error.invalidTag');
    }
    const tag: Tag = { id: ctx.id, name: p.name.trim(), color: p.color.toLowerCase(), description: p.description, deleted: false };
    return applied({ ...state, tags: { ...state.tags, [tag.id]: tag }, tagOrder: [...state.tagOrder, tag.id] });
  },
});

const EditTag = defineCommand<TimetrackState, EditTagPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const tag = liveTag(state, p?.tagId);
    if (!tag) return rejected('timetrack.error.noSuchTag');
    const { name, color, description } = p;
    if (name === undefined && color === undefined && description === undefined) return rejected('timetrack.error.noChanges');
    if (name !== undefined && !isTagName(name)) return rejected('timetrack.error.invalidTag');
    if (color !== undefined && !isColor(color)) return rejected('timetrack.error.invalidTag');
    if (description !== undefined && !isDescription(description)) return rejected('timetrack.error.invalidTag');
    const next: Tag = {
      ...tag,
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(color !== undefined ? { color: color.toLowerCase() } : {}),
      ...(description !== undefined ? { description } : {}),
    };
    return applied({ ...state, tags: { ...state.tags, [tag.id]: next } });
  },
});

const DeleteTag = defineCommand<TimetrackState, TagIdPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const tag = liveTag(state, p?.tagId);
    if (!tag) return rejected('timetrack.error.noSuchTag');
    return applied({ ...state, tags: { ...state.tags, [tag.id]: { ...tag, deleted: true } } });
  },
});

/** Track-targets switch and full-time hours. The switch only hides UI; no data is dropped. */
const SetTargetSettings = defineCommand<TimetrackState, SetTargetSettingsPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const { enabled, fulltimeMs, applyFrom } = p ?? {};
    if (enabled === undefined && fulltimeMs === undefined) return rejected('timetrack.error.noChanges');
    if (enabled !== undefined && typeof enabled !== 'boolean') return rejected('timetrack.error.invalidTarget');
    let targets = state.targets;
    if (enabled !== undefined) targets = { ...targets, enabled };
    if (fulltimeMs !== undefined) {
      if (!isTargetMs(fulltimeMs) || fulltimeMs === 0) return rejected('timetrack.error.invalidFulltime');
      if (applyFrom !== undefined && applyFrom !== null && !isDayKey(applyFrom)) return rejected('timetrack.error.invalidTarget');
      targets = withFulltime(targets, fulltimeMs, applyFrom ?? null);
    }
    return applied({ ...state, targets });
  },
});

const SetDayTarget = defineCommand<TimetrackState, SetDayTargetPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    if (!isDayKey(p?.day) || (p.target !== null && !isDayTarget(p.target))) return rejected('timetrack.error.invalidTarget');
    const target = p.target === null ? null : 'ms' in p.target ? { ms: p.target.ms } : { percent: p.target.percent };
    return applied({ ...state, targets: withDayTarget(state.targets, p.day, target) });
  },
});

const SetBalanceInterval = defineCommand<TimetrackState, SetBalanceIntervalPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const from = p?.from ?? null;
    const to = p?.to ?? null;
    if ((from !== null && !isDayKey(from)) || (to !== null && !isDayKey(to))) return rejected('timetrack.error.invalidTarget');
    if (from !== null && to !== null && from > to) return rejected('timetrack.error.intervalOrder');
    return applied({ ...state, targets: { ...state.targets, interval: { from, to } } });
  },
});

export const timetrackModule = defineModule<TimetrackState>({
  id: 'timetrack',
  ns: 'tt',
  initialState: () => ({
    dayWindow: { ...DEFAULT_DAY_WINDOW },
    blocks: EMPTY_INDEX,
    runningId: null,
    tags: {},
    tagOrder: [],
    targets: INITIAL_TARGETS,
  }),
  commands: {
    SetDayWindow,
    CreateBlock,
    StartTracking,
    StopTracking,
    EditBlock,
    DeleteBlock,
    CreateTag,
    EditTag,
    DeleteTag,
    SetTargetSettings,
    SetDayTarget,
    SetBalanceInterval,
  },
  catalog: timetrackCatalog,
});

// ---------------------------------------------------------------------------------------------
// Queries used by the UI

/** Live tags in panel order. */
export function liveTags(state: TimetrackState): Tag[] {
  return state.tagOrder.map((id) => state.tags[id]!).filter((t) => !t.deleted);
}

/** A block's tags that still exist, in the block's order. Deleted tags are ignored. */
export function blockTags(state: TimetrackState, block: Block): Tag[] {
  return block.tagIds.map((id) => liveTag(state, id)).filter((t): t is Tag => !!t);
}

/** Another live tag with the same name (trimmed, case-insensitive), for the UI's uniqueness check. */
export function findTagByName(state: TimetrackState, name: string, exceptId?: string): Tag | undefined {
  const key = name.trim().toLocaleLowerCase();
  return liveTags(state).find((t) => t.id !== exceptId && t.name.toLocaleLowerCase() === key);
}

/** Ids of live tags whose name is shared with another live tag (possible after a merge). */
export function duplicateTagIds(state: TimetrackState): Set<string> {
  const byName = new Map<string, string[]>();
  for (const t of liveTags(state)) {
    const key = t.name.toLocaleLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), t.id]);
  }
  return new Set([...byName.values()].filter((ids) => ids.length > 1).flat());
}

/** The least-used of the first seven Dark2 colours among live tags (ties go to palette order). */
export function nextTagColor(state: TimetrackState): string {
  const used = new Map<string, number>(AUTO_TAG_COLORS.map((c) => [c, 0]));
  for (const t of liveTags(state)) if (used.has(t.color)) used.set(t.color, used.get(t.color)! + 1);
  let best: string = AUTO_TAG_COLORS[0]!;
  for (const c of AUTO_TAG_COLORS) if (used.get(c)! < used.get(best)!) best = c;
  return best;
}

export function runningBlock(state: TimetrackState): Block | undefined {
  return state.runningId ? getBlock(state.blocks, state.runningId) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Actions: the only way UI code builds timetrack commands. They fill in `deps` (§3.4).

export const timetrackActions = {
  setDayWindow: (p: DayWindow): Action<DayWindow> => ({ t: 'tt.SetDayWindow', p }),
  createBlock: (p: CreateBlockPayload): Action<CreateBlockPayload> => ({ t: 'tt.CreateBlock', p, deps: [...p.tagIds] }),
  startTracking: (p: StartTrackingPayload): Action<StartTrackingPayload> => ({ t: 'tt.StartTracking', p, deps: [...p.tagIds] }),
  stopTracking: (blockId: string, endMs: number): Action<StopTrackingPayload> => ({
    t: 'tt.StopTracking',
    p: { blockId, endMs },
    deps: [blockId],
  }),
  editBlock: (p: EditBlockPayload): Action<EditBlockPayload> => ({
    t: 'tt.EditBlock',
    p,
    deps: [p.blockId, ...(p.tagIds ?? [])],
  }),
  deleteBlock: (blockId: string): Action<BlockIdPayload> => ({ t: 'tt.DeleteBlock', p: { blockId }, deps: [blockId] }),
  createTag: (p: CreateTagPayload): Action<CreateTagPayload> => ({ t: 'tt.CreateTag', p }),
  editTag: (p: EditTagPayload): Action<EditTagPayload> => ({ t: 'tt.EditTag', p, deps: [p.tagId] }),
  deleteTag: (tagId: string): Action<TagIdPayload> => ({ t: 'tt.DeleteTag', p: { tagId }, deps: [tagId] }),
  setTargetSettings: (p: SetTargetSettingsPayload): Action<SetTargetSettingsPayload> => ({ t: 'tt.SetTargetSettings', p }),
  setDayTarget: (day: string, target: DayTarget | null): Action<SetDayTargetPayload> => ({
    t: 'tt.SetDayTarget',
    p: { day, target },
  }),
  setBalanceInterval: (p: SetBalanceIntervalPayload): Action<SetBalanceIntervalPayload> => ({ t: 'tt.SetBalanceInterval', p }),
};
