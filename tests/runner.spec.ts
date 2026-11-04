import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/core/command/runner';
import type { Command } from '../src/core/command/types';
import { ModuleRegistry } from '../src/core/module';
import { Session } from '../src/core/session';
import { act, rng, TEST_MODULES, type CounterState } from './helpers/test-modules';

function session(writerId = 'wa', start = 1_000) {
  let t = start;
  return new Session({ modules: TEST_MODULES, writerId, now: () => t++ });
}

const counter = (s: Session) => s.getState<CounterState>('counter');

function freshReplay(commands: Command[]): CommandRunner {
  const r = new CommandRunner(new ModuleRegistry(TEST_MODULES));
  // Ingest in reverse to make sure order comes from the keys, not from arrival.
  r.ingest([...commands].reverse());
  return r;
}

describe('execute', () => {
  it('applies valid commands and rejects invalid ones without logging them', () => {
    const s = session();
    expect(s.dispatch(act.add(2)).ok).toBe(true);
    const bad = s.dispatch(act.rename('nope', 'x'));
    expect(bad).toEqual({ ok: false, reason: 'test.noSuchItem', params: { itemId: 'nope' } });
    expect(counter(s).value).toBe(2);
    expect(s.runner.size).toBe(1);
  });

  it('refuses unknown types, duplicate ids, missing deps and out-of-order timestamps', () => {
    const s = session();
    expect(s.dispatch({ t: 'ctr.Nope', p: {} })).toMatchObject({ ok: false, reason: 'core.unknownCommand' });
    expect(s.dispatch({ ...act.add(1), deps: ['zz.1'] })).toMatchObject({ ok: false, reason: 'core.missingDependency' });
    const r = s.runner;
    s.dispatch(act.add(1));
    const first = r.commands()[0]!;
    expect(r.execute({ ...first })).toMatchObject({ reason: 'core.duplicateCommandId' });
    expect(r.execute({ ...first, id: 'wa.zz', at: 1 })).toMatchObject({ reason: 'core.clockOutOfOrder' });
    expect(r.execute({ ...first, id: 'not an id' })).toMatchObject({ reason: 'core.invalidCommand' });
  });
});

describe('undo / redo', () => {
  it('undoes and redoes in stack order, and a new action clears the redo branch', () => {
    const s = session();
    s.dispatch(act.add(1));
    s.dispatch(act.add(10));
    s.dispatch(act.add(100));
    s.undo('counter');
    s.undo('counter');
    expect(counter(s).value).toBe(1);
    s.redo('counter');
    expect(counter(s).value).toBe(11);
    s.redo('counter');
    expect(counter(s).value).toBe(111);
    expect(s.canRedo('counter')).toBe(false);

    s.undo('counter');
    expect(counter(s).value).toBe(11);
    s.dispatch(act.add(5));
    expect(s.canRedo('counter')).toBe(false);
    s.undo('counter');
    s.undo('counter');
    expect(counter(s).value).toBe(1);
  });

  it('keeps one undo stack per module', () => {
    const s = session();
    s.dispatch(act.add(1));
    s.dispatch(act.toggle());
    s.undo('counter');
    expect(counter(s).value).toBe(0);
    expect(s.getState<{ flag: boolean }>('other').flag).toBe(true);
    expect(s.canUndo('counter')).toBe(false);
    s.undo('other');
    expect(s.getState<{ flag: boolean }>('other').flag).toBe(false);
    s.redo('counter');
    expect(counter(s).value).toBe(1);
  });

  it('skips non-undoable commands and does not let them clear redo', () => {
    const s = session();
    s.dispatch(act.add(1));
    s.dispatch(act.tick(5));
    s.undo('counter');
    expect(counter(s).value).toBe(5);
    s.dispatch(act.tick(5));
    expect(s.canRedo('counter')).toBe(true);
  });

  it('blocks undo while an active command depends on the target', () => {
    const s = session();
    s.dispatch(act.create('i1', 'A'));
    const createId = s.runner.commands()[0]!.id;
    s.dispatch(act.touch('i1', [createId]));
    expect(s.canUndo('counter')).toBe(false);
    expect(s.undo('counter')).toMatchObject({ ok: false, reason: 'core.nothingToUndo' });
  });

  it('cascades a merged undo to dependents', () => {
    const a = session('wa');
    a.dispatch(act.create('i1', 'A'));
    const createId = a.runner.commands()[0]!.id;
    const b = session('wb', 2_000);
    b.ingest(a.runner.commands());
    b.dispatch(act.rename('i1', 'B', [createId]));
    a.undo('counter');
    a.ingest(b.runner.commands());
    expect(counter(a).items).toEqual({});
    expect(a.runner.isSuppressed(b.runner.commands()[1]!.id)).toBe(true);
  });

  it('undoes and redoes a batch as one step, and rejects it atomically', () => {
    const s = session();
    expect(s.dispatchBatch([act.add(1), act.add(2)]).ok).toBe(true);
    expect(counter(s).value).toBe(3);
    expect(s.dispatchBatch([act.add(1), act.rename('missing', 'x')]).ok).toBe(false);
    expect(counter(s).value).toBe(3);
    expect(s.dispatchBatch([act.add(1), act.toggle()])).toMatchObject({ reason: 'core.batchMixedScopes' });
    s.undo('counter');
    expect(counter(s).value).toBe(0);
    s.redo('counter');
    expect(counter(s).value).toBe(3);
  });
});

describe('merge', () => {
  it('orders commands by (at, writer, seq) regardless of arrival order', () => {
    const a = session('wa', 1_000);
    const b = session('wb', 1_000);
    a.dispatch(act.add(1));
    b.dispatch(act.scale(10));
    a.dispatch(act.add(2));
    // Total order: wa.1@1000, wb.1@1000, wa.2@1001 → ((0+1)*10)+2
    a.ingest(b.runner.commands());
    b.ingest(a.runner.commands());
    expect(counter(a).value).toBe(12);
    expect(counter(b).value).toBe(12);
    expect(a.runner.commands().map((c) => c.id)).toEqual(b.runner.commands().map((c) => c.id));
  });

  it('records commands that no longer validate as rejected-on-merge instead of failing', () => {
    const a = session('wa', 1_000);
    a.dispatch(act.create('i1', 'A'));
    const b = session('wb', 5_000);
    b.ingest(a.runner.commands());
    b.dispatch(act.rename('i1', 'B')); // no deps declared
    a.undo('counter');
    a.ingest(b.runner.commands());
    const issues = a.runner.issues();
    expect(issues.rejected).toHaveLength(1);
    expect(issues.rejected[0]).toMatchObject({ type: 'ctr.RenameItem', reason: 'test.noSuchItem' });
    a.redo('counter');
    expect(a.runner.issues().rejected).toHaveLength(0);
    expect(counter(a).items).toEqual({ i1: 'B' });
  });

  it('keeps unknown command types, flags newer payload versions and upcasts older ones', () => {
    const s = session();
    s.ingest([
      { id: 'zz.1', t: 'future.Thing', v: 1, at: 10, p: {} },
      { id: 'zz.2', t: 'ctr.Add', v: 1, at: 11, p: { n: 3 } },
      { id: 'zz.3', t: 'ctr.Scale', v: 1, at: 12, p: { factor: 2 } },
    ]);
    expect(counter(s).value).toBe(6);
    expect(s.runner.issues()).toMatchObject({ unknown: 1, newer: 0 });
    expect(s.readOnly).toBeNull();
    s.ingest([{ id: 'zz.4', t: 'ctr.Add', v: 9, at: 13, p: {} }]);
    expect(s.runner.issues().newer).toBe(1);
    expect(s.readOnly).toBe('newerData');
    expect(s.dispatch(act.add(1))).toMatchObject({ ok: false, reason: 'core.readOnly' });
  });

  it('drops malformed records and duplicates', () => {
    const s = session();
    const added = s.ingest([
      { id: 'zz.1', t: 'ctr.Add', v: 1, at: 10, p: { n: 1 } },
      { id: 'zz.1', t: 'ctr.Add', v: 1, at: 10, p: { n: 1 } },
      { nope: true } as unknown as Command,
    ]);
    expect(added).toBe(1);
    expect(s.runner.issues().invalid).toBe(1);
  });
});

describe('determinism', () => {
  it('incremental state equals a fresh replay, across undo, redo, merges and checkpoints', () => {
    const random = rng(42);
    const writers = [session('wa', 1_000), session('wb', 1_000), session('wc', 1_500)];
    for (const w of writers) {
      // tiny checkpoint interval to exercise checkpoint reuse and thinning
      (w.runner as unknown as { checkpointInterval: number }).checkpointInterval = 7;
    }
    for (let step = 0; step < 1_500; step++) {
      const w = writers[Math.floor(random() * writers.length)]!;
      const roll = random();
      if (roll < 0.45) w.dispatch(act.add(Math.floor(random() * 10)));
      else if (roll < 0.55) w.dispatch(act.scale(random() < 0.5 ? -1 : 2));
      else if (roll < 0.6) w.dispatch(act.create(`i${Math.floor(random() * 40)}`, 'x'));
      else if (roll < 0.62) {
        // Two writers create the same item before syncing: a guaranteed merge conflict.
        for (const x of writers.slice(0, 2)) x.dispatch(act.create(`dup${step}`, x.writerId));
      }
      else if (roll < 0.7) {
        const known = Object.keys(counter(w).items);
        if (known.length) w.dispatch(act.rename(known[Math.floor(random() * known.length)]!, `n${step}`));
      }
      else if (roll < 0.8) w.undo('counter');
      else if (roll < 0.88) w.redo('counter');
      else if (roll < 0.92) w.dispatch(act.toggle());
      else {
        const other = writers[Math.floor(random() * writers.length)]!;
        w.ingest(other.runner.commands());
      }
    }
    const all = writers.flatMap((w) => w.runner.commands());
    for (const w of writers) w.ingest(all);
    const reference = freshReplay(all);
    // The scenario must actually exercise the interesting paths.
    expect(reference.commands().filter((c) => c.t === 'core.Undo').length).toBeGreaterThan(100);
    expect(reference.issues().rejected.length).toBeGreaterThan(0);
    const checkpoints = (writers[0]!.runner as unknown as { checkpoints: unknown[] }).checkpoints.length;
    expect(checkpoints).toBeLessThanOrEqual(64);
    expect(checkpoints).toBeGreaterThan(10);
    for (const w of writers) {
      expect(w.runner.commands().map((c) => c.id)).toEqual(reference.commands().map((c) => c.id));
      expect(counter(w)).toEqual(reference.getState('counter'));
      expect(w.getState('other')).toEqual(reference.getState('other'));
      expect(w.runner.issues().rejected).toEqual(reference.issues().rejected);
    }
  });
});
