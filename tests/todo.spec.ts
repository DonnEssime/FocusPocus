import { describe, expect, it } from 'vitest';
import { encodeLine, parseSegmentText } from '../src/core/vault/segment';
import { Session, type Action } from '../src/core/session';
import {
  childrenOf,
  collapsedAround,
  descendantCount,
  reorderTarget,
  subtreeIds,
  TODO_NOTES_MAX,
  TODO_TITLE_MAX,
  todoActions as td,
  todoModule,
  type TodoState,
} from '../src/modules/todo';
import { rng } from './helpers/test-modules';

const session = (writerId = 'wa') => new Session({ modules: [todoModule], writerId });
const state = (s: Session) => s.getState<TodoState>('todo');
const lastId = (s: Session) => s.runner.commands().at(-1)!.id;
/** Without `deps`, so the module's own existence check runs (the kernel checks deps first). */
const bare = (a: Action): Action => ({ t: a.t, p: a.p });

function add(s: Session, title: string, parentId: string | null = null): string {
  const r = s.dispatch(td.create({ parentId, title }));
  if (!r.ok) throw new Error(`create rejected: ${JSON.stringify(r)}`);
  return lastId(s);
}

/** The tree as nested `[title, children]` pairs (leaves are just the title). */
function shape(st: TodoState, parentId: string | null = null): unknown[] {
  return childrenOf(st, parentId).map((i) => (i.children.length ? [i.title, shape(st, i.id)] : i.title));
}

describe('todo: create', () => {
  it('adds new items at the top of their list, and any leaf can become a parent', () => {
    const s = session();
    const a = add(s, '  Groceries ');
    const b = add(s, 'Taxes');
    const milk = add(s, 'Milk', a);
    add(s, 'Bread', a);
    add(s, 'Full fat', milk);
    expect(shape(state(s))).toEqual(['Taxes', ['Groceries', ['Bread', ['Milk', ['Full fat']]]]]);
    expect(state(s).items[milk]).toMatchObject({ parentId: a, notes: '', done: false, collapsed: false });
    expect(state(s).items[a]!.title).toBe('Groceries');
    expect(descendantCount(state(s), a)).toBe(3);
    expect(subtreeIds(state(s), b)).toEqual([b]);
  });

  it('declares a dependency on the parent', () => {
    expect(td.create({ parentId: null, title: 'x' }).deps).toBeUndefined();
    expect(td.create({ parentId: 'wa.1', title: 'x' }).deps).toEqual(['wa.1']);
  });

  it('rejects empty or too long titles and unknown parents', () => {
    const s = session();
    for (const title of ['', '   ', 'x'.repeat(TODO_TITLE_MAX + 1), 5]) {
      expect(s.dispatch({ t: 'todo.Create', p: { parentId: null, title } })).toMatchObject({ reason: 'todo.error.invalidTitle' });
    }
    expect(s.dispatch(bare(td.create({ parentId: 'nope', title: 'x' })))).toMatchObject({ reason: 'todo.error.noSuchItem' });
    expect(s.dispatch({ t: 'todo.Create', p: { parentId: 3, title: 'x' } })).toMatchObject({ reason: 'todo.error.invalidPayload' });
    expect(s.dispatch({ t: 'todo.Create', p: { parentId: '__proto__', title: 'x' } })).toMatchObject({ reason: 'todo.error.noSuchItem' });
    expect(s.runner.commands()).toHaveLength(0);
  });

  it('opens a collapsed parent when a child is added', () => {
    const s = session();
    const a = add(s, 'A');
    add(s, 'A1', a);
    s.dispatch(td.setCollapsed(a, true));
    add(s, 'A2', a);
    expect(state(s).items[a]!.collapsed).toBe(false);
  });
});

describe('todo: edit, done, collapse', () => {
  it('edits title and notes, only the given fields', () => {
    const s = session();
    const a = add(s, 'A');
    expect(s.dispatch(td.edit({ itemId: a, notes: 'line 1\nline 2' })).ok).toBe(true);
    expect(s.dispatch(td.edit({ itemId: a, title: ' B ' })).ok).toBe(true);
    expect(state(s).items[a]).toMatchObject({ title: 'B', notes: 'line 1\nline 2' });
    expect(s.dispatch(td.edit({ itemId: a }))).toMatchObject({ reason: 'todo.error.noChanges' });
    expect(s.dispatch(td.edit({ itemId: a, title: ' ' }))).toMatchObject({ reason: 'todo.error.invalidTitle' });
    expect(s.dispatch(td.edit({ itemId: a, notes: 'x'.repeat(TODO_NOTES_MAX + 1) }))).toMatchObject({
      reason: 'todo.error.invalidNotes',
    });
    expect(s.dispatch(bare(td.edit({ itemId: 'nope', title: 'x' })))).toMatchObject({ reason: 'todo.error.noSuchItem' });
  });

  it('marks items finished independently of their children; repeating is a no-op', () => {
    const s = session();
    const a = add(s, 'A');
    const a1 = add(s, 'A1', a);
    expect(s.dispatch(td.setDone(a, true)).ok).toBe(true);
    expect(state(s).items[a]!.done).toBe(true);
    expect(state(s).items[a1]!.done).toBe(false);
    const before = state(s);
    expect(s.dispatch(td.setDone(a, true)).ok).toBe(true);
    expect(state(s)).toBe(before);
    expect(s.dispatch({ t: 'todo.SetDone', p: { itemId: a, done: 'yes' } })).toMatchObject({ reason: 'todo.error.invalidPayload' });
  });

  it('collapses without touching the undo stack, and ignores missing items', () => {
    const s = session();
    const a = add(s, 'A');
    s.dispatch(td.edit({ itemId: a, notes: 'n' }));
    expect(s.dispatch(td.setCollapsed(a, true)).ok).toBe(true);
    expect(state(s).items[a]!.collapsed).toBe(true);
    expect(s.dispatch(td.setCollapsed('gone', true)).ok).toBe(true);
    // Undo skips the collapse and reverts the edit.
    s.undo('todo');
    expect(state(s).items[a]).toMatchObject({ notes: '', collapsed: true });
    // A collapse never blocks undoing the creation of its item.
    s.undo('todo');
    expect(state(s).items[a]).toBeUndefined();
    s.redo('todo');
    expect(state(s).items[a]!.collapsed).toBe(true);
  });
});

describe('todo: reorder', () => {
  /** Top-level a, b, c, d (in that order) and the ids by title. */
  function abcd() {
    const s = session();
    const ids: Record<string, string> = {};
    for (const t of ['d', 'c', 'b', 'a']) ids[t] = add(s, t);
    return { s, ids };
  }

  it('moves an item in front of a sibling or to the end, one undo step each', () => {
    const { s, ids } = abcd();
    expect(shape(state(s))).toEqual(['a', 'b', 'c', 'd']);
    expect(s.dispatch(td.reorder(ids.d!, ids.b!)).ok).toBe(true);
    expect(shape(state(s))).toEqual(['a', 'd', 'b', 'c']);
    expect(s.dispatch(td.reorder(ids.a!, null)).ok).toBe(true);
    expect(shape(state(s))).toEqual(['d', 'b', 'c', 'a']);
    s.undo('todo');
    s.undo('todo');
    expect(shape(state(s))).toEqual(['a', 'b', 'c', 'd']);
    expect(td.reorder('x', 'y').deps).toEqual(['x', 'y']);
    expect(td.reorder('x', null).deps).toEqual(['x']);
  });

  it('reorders children without touching other levels', () => {
    const s = session();
    const p = add(s, 'P');
    const x = add(s, 'x', p);
    add(s, 'y', p);
    add(s, 'Q');
    s.dispatch(td.reorder(x, state(s).items[p]!.children[0]!));
    expect(shape(state(s))).toEqual(['Q', ['P', ['x', 'y']]]);
  });

  it('rejects non-siblings, itself and moves that change nothing', () => {
    const s = session();
    const p = add(s, 'P');
    const child = add(s, 'child', p);
    const q = add(s, 'Q');
    expect(s.dispatch(td.reorder(q, child))).toMatchObject({ reason: 'todo.error.notASibling' });
    expect(s.dispatch(td.reorder(q, q))).toMatchObject({ reason: 'todo.error.notASibling' });
    expect(s.dispatch(td.reorder(q, p))).toMatchObject({ reason: 'todo.error.noChanges' });
    expect(s.dispatch(td.reorder(p, null))).toMatchObject({ reason: 'todo.error.noChanges' });
    expect(s.dispatch({ t: 'todo.Reorder', p: { itemId: q, beforeId: 4 } })).toMatchObject({ reason: 'todo.error.invalidPayload' });
  });

  it('turns a drop before or after a sibling into a beforeId, or undefined when nothing moves', () => {
    const { s, ids } = abcd();
    const st = state(s);
    expect(reorderTarget(st, ids.a!, ids.c!, false)).toBe(ids.c);
    expect(reorderTarget(st, ids.a!, ids.c!, true)).toBe(ids.d);
    expect(reorderTarget(st, ids.a!, ids.d!, true)).toBeNull();
    expect(reorderTarget(st, ids.d!, ids.a!, false)).toBe(ids.a);
    expect(reorderTarget(st, ids.b!, ids.a!, true)).toBeUndefined();
    expect(reorderTarget(st, ids.b!, ids.c!, false)).toBeUndefined();
    expect(reorderTarget(st, ids.b!, ids.b!, false)).toBeUndefined();
    const child = add(s, 'child', ids.a!);
    expect(reorderTarget(state(s), child, ids.b!, false)).toBeUndefined();
  });
});

describe('todo: reveal after undo', () => {
  it('lists exactly the collapsed ancestors hiding the item, or the place it was', () => {
    const s = session();
    const a = add(s, 'A');
    const b = add(s, 'B', a);
    const c = add(s, 'C', b);
    const d = add(s, 'D', c);
    s.dispatch(td.edit({ itemId: d, notes: 'n' }));
    s.dispatch(td.setCollapsed(a, true));
    s.dispatch(td.setCollapsed(c, true));
    const st = state(s);
    const editCmd = s.runner.commands().find((x) => x.t === 'todo.Edit')!;
    // B is open, so only A and C need opening.
    expect(collapsedAround(editCmd, st, st).sort()).toEqual([a, c].sort());
    // An action on a collapsed item itself does not open it.
    expect(collapsedAround({ id: 'z', t: 'todo.SetDone', p: { itemId: c } }, st, st)).toEqual([a]);
    // An undone Create: the item is gone, so reveal its parent (C is collapsed) and above.
    const createD = s.runner.commands().find((x) => x.id === d)!;
    const without = { ...st, items: { ...st.items } };
    delete (without.items as Record<string, unknown>)[d];
    expect(collapsedAround(createD, st, without).sort()).toEqual([a, c].sort());
    // A top-level item needs nothing; other modules' commands are ignored.
    expect(collapsedAround({ id: 'z', t: 'todo.SetDone', p: { itemId: a } }, st, st)).toEqual([]);
    expect(collapsedAround({ id: 'z', t: 'tt.DeleteBlock', p: { itemId: d } }, st, st)).toEqual([]);
  });
});

describe('todo: delete and undo', () => {
  it('deletes an item with its whole subtree, and undo restores it in place', () => {
    const s = session();
    const a = add(s, 'A');
    const a1 = add(s, 'A1', a);
    add(s, 'A1a', a1);
    add(s, 'A2', a);
    add(s, 'B');
    s.dispatch(td.delete(a1));
    expect(shape(state(s))).toEqual(['B', ['A', ['A2']]]);
    expect(Object.keys(state(s).items)).toHaveLength(3);
    s.dispatch(td.delete(a));
    expect(shape(state(s))).toEqual(['B']);
    s.undo('todo');
    s.undo('todo');
    expect(shape(state(s))).toEqual(['B', ['A', ['A2', ['A1', ['A1a']]]]]);
    expect(s.dispatch(bare(td.delete('nope')))).toMatchObject({ reason: 'todo.error.noSuchItem' });
  });

  it('undoes creations newest first and redoes them', () => {
    const s = session();
    const a = add(s, 'A');
    add(s, 'A1', a);
    s.undo('todo');
    expect(shape(state(s))).toEqual(['A']);
    s.undo('todo');
    expect(shape(state(s))).toEqual([]);
    s.redo('todo');
    s.redo('todo');
    expect(shape(state(s))).toEqual([['A', ['A1']]]);
  });
});

describe('todo: merges', () => {
  it('rejects a child added under an item another writer deleted', () => {
    const a = session('wa');
    const b = session('wb');
    const p = add(a, 'Parent');
    b.ingest(a.runner.commands());
    a.dispatch(td.delete(p));
    add(b, 'Child', p);
    b.ingest(a.runner.commands());
    a.ingest(b.runner.commands());
    expect(state(a)).toEqual(state(b));
    expect(shape(state(a))).toEqual([]);
  });

  it('round-trips through the segment line codec', () => {
    const s = session();
    const a = add(s, 'A');
    s.dispatch(td.edit({ itemId: a, notes: 'ünïcødé\n“quotes”' }));
    s.dispatch(td.setDone(a, true));
    s.dispatch(td.setCollapsed(a, true));
    const copy = session('wb');
    copy.ingest(parseSegmentText(s.runner.commands().map(encodeLine).join('\n')).commands);
    expect(state(copy)).toEqual(state(s));
  });

  it('incremental state equals a fresh replay across random edits, undo and merges', () => {
    const random = rng(7);
    const writers = [session('wa'), session('wb'), session('wc')];
    const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(random() * xs.length)];
    for (let step = 0; step < 1_200; step++) {
      const w = pick(writers)!;
      const ids = Object.keys(state(w).items);
      const roll = random();
      if (roll < 0.3) w.dispatch(td.create({ parentId: random() < 0.3 ? null : (pick(ids) ?? null), title: `t${step}` }));
      else if (roll < 0.4 && ids.length) w.dispatch(td.edit({ itemId: pick(ids)!, notes: `n${step}` }));
      else if (roll < 0.5 && ids.length) w.dispatch(td.setDone(pick(ids)!, random() < 0.5));
      else if (roll < 0.58 && ids.length) w.dispatch(td.setCollapsed(pick(ids)!, random() < 0.5));
      else if (roll < 0.62 && ids.length) {
        const item = state(w).items[pick(ids)!]!;
        const siblings = childrenOf(state(w), item.parentId).filter((x) => x.id !== item.id);
        w.dispatch(td.reorder(item.id, random() < 0.2 ? null : (pick(siblings)?.id ?? null)));
      } else if (roll < 0.67 && ids.length) w.dispatch(td.delete(pick(ids)!));
      else if (roll < 0.75) w.undo('todo');
      else if (roll < 0.82) w.redo('todo');
      else w.ingest(pick(writers)!.runner.commands());
    }
    const all = writers.flatMap((w) => w.runner.commands());
    for (const w of writers) w.ingest(all);
    const fresh = session('zz');
    fresh.ingest(all);
    expect(Object.keys(state(fresh).items).length).toBeGreaterThan(0);
    for (const w of writers) expect(state(w)).toEqual(state(fresh));
    // Structural invariants: a pure tree whose links agree in both directions.
    const st = state(fresh);
    const seen = new Set<string>();
    const walk = (parentId: string | null) => {
      for (const item of childrenOf(st, parentId)) {
        expect(item.parentId).toBe(parentId);
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
        walk(item.id);
      }
    };
    walk(null);
    expect(seen.size).toBe(Object.keys(st.items).length);
  });
});
