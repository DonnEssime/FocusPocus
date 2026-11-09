import type { Action } from '../../core/session';
import { applied, defineCommand, defineModule, rejected, type ApplyResult } from '../../core/module';
import { todoCatalog } from './catalog';

export const TODO_TITLE_MAX = 200;
export const TODO_NOTES_MAX = 20_000;

/**
 * One node of the to-do tree. The tree is pure: every item has at most one parent, and any item
 * can get children.
 */
export interface TodoItem {
  /** Id of the `todo.Create` command that made it. */
  id: string;
  /** `null` for a top-level item. */
  parentId: string | null;
  title: string;
  /** Plain text. */
  notes: string;
  done: boolean;
  /** Whether its children are hidden. Shared through the vault, but not on the undo stack. */
  collapsed: boolean;
  /** Child ids in display order (new items go first; the user can reorder them). */
  children: readonly string[];
}

export interface TodoState {
  items: Readonly<Record<string, TodoItem>>;
  /** Top-level ids in display order. */
  roots: readonly string[];
}

export interface CreateTodoPayload {
  parentId: string | null;
  title: string;
}

export interface EditTodoPayload {
  itemId: string;
  title?: string;
  notes?: string;
}

export interface SetTodoDonePayload {
  itemId: string;
  done: boolean;
}

export interface SetTodoCollapsedPayload {
  itemId: string;
  collapsed: boolean;
}

export interface ReorderTodoPayload {
  itemId: string;
  /** The sibling to move in front of; `null` moves the item to the end. */
  beforeId: string | null;
}

export interface TodoIdPayload {
  itemId: string;
}

export const EMPTY_TODOS: TodoState = { items: {}, roots: [] };

function isTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= TODO_TITLE_MAX;
}

function isNotes(value: unknown): value is string {
  return typeof value === 'string' && value.length <= TODO_NOTES_MAX;
}

function getItem(state: TodoState, id: unknown): TodoItem | undefined {
  return typeof id === 'string' && Object.hasOwn(state.items, id) ? state.items[id] : undefined;
}

const noSuchItem = <S>(): ApplyResult<S> => rejected('todo.error.noSuchItem');
const invalidTitle = <S>(): ApplyResult<S> => rejected('todo.error.invalidTitle', { max: TODO_TITLE_MAX });

/** The children of `parentId`, or the top-level items for `null`. */
export function childrenOf(state: TodoState, parentId: string | null): TodoItem[] {
  const ids = parentId === null ? state.roots : (state.items[parentId]?.children ?? []);
  return ids.map((id) => state.items[id]!);
}

/** The item and all its descendants, depth first. */
export function subtreeIds(state: TodoState, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const next = stack.pop()!;
    const item = state.items[next];
    if (!item) continue;
    out.push(next);
    for (let i = item.children.length - 1; i >= 0; i--) stack.push(item.children[i]!);
  }
  return out;
}

/** Ids of the item's siblings, itself included, in display order. */
function siblingIds(state: TodoState, item: TodoItem): readonly string[] {
  return item.parentId === null ? state.roots : state.items[item.parentId]!.children;
}

/** `ids` with the list of `parentId` (or the top level) replaced. */
function withSiblings(state: TodoState, parentId: string | null, ids: readonly string[]): TodoState {
  if (parentId === null) return { ...state, roots: ids };
  return withItem(state, { ...state.items[parentId]!, children: ids });
}

/**
 * The `beforeId` that drops `itemId` just before (or, with `after`, just after) its sibling
 * `targetId`, or `undefined` when that would not move it (or the two are not siblings).
 */
export function reorderTarget(state: TodoState, itemId: string, targetId: string, after: boolean): string | null | undefined {
  const item = state.items[itemId];
  const target = state.items[targetId];
  if (!item || !target || itemId === targetId || item.parentId !== target.parentId) return undefined;
  const ids = siblingIds(state, item);
  const others = ids.filter((id) => id !== itemId);
  const beforeId = others[others.indexOf(targetId) + (after ? 1 : 0)] ?? null;
  const currentNext = ids[ids.indexOf(itemId) + 1] ?? null;
  return beforeId === currentNext ? undefined : beforeId;
}

/**
 * Collapsed items that keep the item a command is about out of sight: its collapsed ancestors in
 * `after`, starting from its parent. For an item that no longer exists (an undone Create, a redone
 * Delete) this reveals where it was, so the change is visible. `before` is the state the command's
 * undo or redo started from.
 */
export function collapsedAround(cmd: { id: string; t: string; p: unknown }, before: TodoState, after: TodoState): string[] {
  if (!cmd.t.startsWith('todo.')) return [];
  const p = (cmd.p ?? {}) as { itemId?: unknown; parentId?: unknown };
  const itemId = cmd.t === 'todo.Create' ? cmd.id : p.itemId;
  if (typeof itemId !== 'string') return [];
  const item = getItem(after, itemId) ?? getItem(before, itemId);
  let anchor = item ? item.parentId : typeof p.parentId === 'string' ? p.parentId : null;
  const out: string[] = [];
  while (anchor !== null) {
    const a = getItem(after, anchor);
    if (!a) break;
    if (a.collapsed) out.push(a.id);
    anchor = a.parentId;
  }
  return out;
}

/** Number of descendants (not counting the item itself). */
export function descendantCount(state: TodoState, id: string): number {
  return Math.max(0, subtreeIds(state, id).length - 1);
}

function withItem(state: TodoState, item: TodoItem): TodoState {
  return { ...state, items: { ...state.items, [item.id]: item } };
}

/** Adds an item as the first child of its parent (or as the first top-level item). */
const Create = defineCommand<TodoState, CreateTodoPayload>({
  v: 1,
  undoable: true,
  apply(state, p, ctx) {
    if (!p || (p.parentId !== null && typeof p.parentId !== 'string')) return rejected('todo.error.invalidPayload');
    if (!isTitle(p.title)) return invalidTitle();
    const parent = p.parentId === null ? null : getItem(state, p.parentId);
    if (parent === undefined) return noSuchItem();
    const item: TodoItem = {
      id: ctx.id,
      parentId: parent?.id ?? null,
      title: p.title.trim(),
      notes: '',
      done: false,
      collapsed: false,
      children: [],
    };
    const items: Record<string, TodoItem> = { ...state.items, [item.id]: item };
    if (!parent) return applied({ ...state, items, roots: [item.id, ...state.roots] });
    // Adding a child shows it: the parent opens if it was collapsed.
    items[parent.id] = { ...parent, collapsed: false, children: [item.id, ...parent.children] };
    return applied({ ...state, items });
  },
});

const Edit = defineCommand<TodoState, EditTodoPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const item = getItem(state, p?.itemId);
    if (!item) return noSuchItem();
    const { title, notes } = p;
    if (title === undefined && notes === undefined) return rejected('todo.error.noChanges');
    if (title !== undefined && !isTitle(title)) return invalidTitle();
    if (notes !== undefined && !isNotes(notes)) return rejected('todo.error.invalidNotes', { max: TODO_NOTES_MAX });
    return applied(
      withItem(state, {
        ...item,
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(notes !== undefined ? { notes } : {}),
      }),
    );
  },
});

/** Finished or not. Setting the current value again is a harmless no-op (two windows both ticking it). */
const SetDone = defineCommand<TodoState, SetTodoDonePayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const item = getItem(state, p?.itemId);
    if (!item) return noSuchItem();
    if (typeof p.done !== 'boolean') return rejected('todo.error.invalidPayload');
    return applied(item.done === p.done ? state : withItem(state, { ...item, done: p.done }));
  },
});

/**
 * Collapses or expands an item. This is view state, so it is not undoable and carries no `deps`
 * (a non-undoable dependent would block undoing the item's creation). A missing item is ignored.
 */
const SetCollapsed = defineCommand<TodoState, SetTodoCollapsedPayload>({
  v: 1,
  undoable: false,
  apply(state, p) {
    if (typeof p?.itemId !== 'string' || typeof p.collapsed !== 'boolean') return rejected('todo.error.invalidPayload');
    const item = getItem(state, p.itemId);
    if (!item || item.collapsed === p.collapsed) return applied(state);
    return applied(withItem(state, { ...item, collapsed: p.collapsed }));
  },
});

/** Moves an item among its siblings. It never changes the parent: the tree stays as it was built. */
const Reorder = defineCommand<TodoState, ReorderTodoPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const item = getItem(state, p?.itemId);
    if (!item) return noSuchItem();
    if (p.beforeId !== null && typeof p.beforeId !== 'string') return rejected('todo.error.invalidPayload');
    const ids = siblingIds(state, item);
    if (p.beforeId === item.id || (p.beforeId !== null && !ids.includes(p.beforeId))) return rejected('todo.error.notASibling');
    const others = ids.filter((id) => id !== item.id);
    const at = p.beforeId === null ? others.length : others.indexOf(p.beforeId);
    others.splice(at, 0, item.id);
    if (others.every((id, i) => id === ids[i])) return rejected('todo.error.noChanges');
    return applied(withSiblings(state, item.parentId, others));
  },
});

/** Deletes an item together with all its descendants. */
const Delete = defineCommand<TodoState, TodoIdPayload>({
  v: 1,
  undoable: true,
  apply(state, p) {
    const item = getItem(state, p?.itemId);
    if (!item) return noSuchItem();
    const items: Record<string, TodoItem> = { ...state.items };
    for (const id of subtreeIds(state, item.id)) delete items[id];
    if (item.parentId === null) return applied({ ...state, items, roots: state.roots.filter((id) => id !== item.id) });
    const parent = items[item.parentId]!;
    items[parent.id] = { ...parent, children: parent.children.filter((id) => id !== item.id) };
    return applied({ ...state, items });
  },
});

export const todoModule = defineModule<TodoState>({
  id: 'todo',
  ns: 'todo',
  initialState: () => EMPTY_TODOS,
  commands: { Create, Edit, SetDone, SetCollapsed, Reorder, Delete },
  catalog: todoCatalog,
});

export const todoActions = {
  create: (p: CreateTodoPayload): Action<CreateTodoPayload> => ({
    t: 'todo.Create',
    p,
    ...(p.parentId !== null ? { deps: [p.parentId] } : {}),
  }),
  edit: (p: EditTodoPayload): Action<EditTodoPayload> => ({ t: 'todo.Edit', p, deps: [p.itemId] }),
  setDone: (itemId: string, done: boolean): Action<SetTodoDonePayload> => ({
    t: 'todo.SetDone',
    p: { itemId, done },
    deps: [itemId],
  }),
  setCollapsed: (itemId: string, collapsed: boolean): Action<SetTodoCollapsedPayload> => ({
    t: 'todo.SetCollapsed',
    p: { itemId, collapsed },
  }),
  reorder: (itemId: string, beforeId: string | null): Action<ReorderTodoPayload> => ({
    t: 'todo.Reorder',
    p: { itemId, beforeId },
    deps: beforeId === null ? [itemId] : [itemId, beforeId],
  }),
  delete: (itemId: string): Action<TodoIdPayload> => ({ t: 'todo.Delete', p: { itemId }, deps: [itemId] }),
};
