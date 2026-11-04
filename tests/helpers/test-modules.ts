import { applied, defineCommand, defineModule, rejected, type ModuleDefinition } from '../../src/core/module';
import type { Action } from '../../src/core/session';

/** Immutable test state: a counter and a map of named items. */
export interface CounterState {
  value: number;
  items: Record<string, string>;
}

export const counterModule = defineModule<CounterState>({
  id: 'counter',
  ns: 'ctr',
  initialState: () => ({ value: 0, items: {} }),
  catalog: {},
  commands: {
    Add: defineCommand<CounterState, { n: number }>({
      v: 1,
      undoable: true,
      apply: (s, p) => (Number.isFinite(p.n) ? applied({ ...s, value: s.value + p.n }) : rejected('test.badNumber')),
    }),
    /** v2 payload `{ mult }`; v1 payloads were `{ factor }`. */
    Scale: defineCommand<CounterState, { mult: number }>({
      v: 2,
      undoable: true,
      upcast: { 1: (p) => ({ mult: (p as { factor: number }).factor }) },
      apply: (s, p) => applied({ ...s, value: s.value * p.mult }),
    }),
    Tick: defineCommand<CounterState, { n: number }>({
      v: 1,
      undoable: false,
      apply: (s, p) => applied({ ...s, value: s.value + p.n }),
    }),
    CreateItem: defineCommand<CounterState, { itemId: string; name: string }>({
      v: 1,
      undoable: true,
      apply: (s, p) =>
        s.items[p.itemId] !== undefined
          ? rejected('test.itemExists')
          : applied({ ...s, items: { ...s.items, [p.itemId]: p.name } }),
    }),
    RenameItem: defineCommand<CounterState, { itemId: string; name: string }>({
      v: 1,
      undoable: true,
      apply: (s, p) =>
        s.items[p.itemId] === undefined
          ? rejected('test.noSuchItem', { itemId: p.itemId })
          : applied({ ...s, items: { ...s.items, [p.itemId]: p.name } }),
    }),
    TouchItem: defineCommand<CounterState, { itemId: string }>({
      v: 1,
      undoable: false,
      apply: (s, p) => (s.items[p.itemId] === undefined ? rejected('test.noSuchItem') : applied(s)),
    }),
  },
});

export const otherModule = defineModule<{ flag: boolean }>({
  id: 'other',
  ns: 'oth',
  initialState: () => ({ flag: false }),
  catalog: {},
  commands: {
    Toggle: defineCommand<{ flag: boolean }, Record<string, never>>({
      v: 1,
      undoable: true,
      apply: (s) => applied({ flag: !s.flag }),
    }),
  },
});

export const TEST_MODULES: readonly ModuleDefinition<any>[] = [counterModule, otherModule];

export const act = {
  add: (n: number): Action => ({ t: 'ctr.Add', p: { n } }),
  scale: (mult: number): Action => ({ t: 'ctr.Scale', p: { mult } }),
  tick: (n: number): Action => ({ t: 'ctr.Tick', p: { n } }),
  create: (itemId: string, name: string): Action => ({ t: 'ctr.CreateItem', p: { itemId, name } }),
  rename: (itemId: string, name: string, deps?: string[]): Action => ({ t: 'ctr.RenameItem', p: { itemId, name }, ...(deps ? { deps } : {}) }),
  touch: (itemId: string, deps?: string[]): Action => ({ t: 'ctr.TouchItem', p: { itemId }, ...(deps ? { deps } : {}) }),
  toggle: (): Action => ({ t: 'oth.Toggle', p: {} }),
};

/** Deterministic pseudo-random generator for property-style tests. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
