import { afterEach, describe, expect, it } from 'vitest';
import { MemoryBackend } from '../src/core/storage/memory';
import { createBroadcastChannelPort } from '../src/core/vault/broadcast';
import { LIVE_DIR } from '../src/core/vault/paths';
import { createVault } from '../src/core/vault/vault';
import { VaultSession, type VaultSessionOptions } from '../src/core/vault/vault-session';
import { act, TEST_MODULES, type CounterState } from './helpers/test-modules';
import { SyncLink } from './helpers/sync';

const open: VaultSession[] = [];

async function openSession(backend: MemoryBackend, extra: Partial<VaultSessionOptions> = {}) {
  const vs = await VaultSession.open(backend, { modules: TEST_MODULES, ...extra });
  open.push(vs);
  return vs;
}

const value = (vs: VaultSession) => vs.session.getState<CounterState>('counter').value;
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  await Promise.all(open.splice(0).map((vs) => vs.close()));
});

describe('VaultSession', () => {
  it('persists commands and restores state and undo history on reopen', async () => {
    const backend = new MemoryBackend();
    await createVault(backend);
    const first = await openSession(backend);
    first.session.dispatch(act.add(1));
    first.session.dispatch(act.add(10));
    first.session.undo('counter');
    await first.close();

    const second = await openSession(backend);
    expect(value(second)).toBe(1);
    expect(second.session.canRedo('counter')).toBe(true);
    second.session.redo('counter');
    expect(value(second)).toBe(11);
  });

  it('syncs windows of the same browser instantly, including unsaved commands of already-open windows', async () => {
    const backend = new MemoryBackend();
    await createVault(backend);
    const options = { broadcast: createBroadcastChannelPort, flushDelayMs: 60_000, maxFlushDelayMs: 60_000 };
    const a = await openSession(backend, options);
    a.start();
    a.session.dispatch(act.add(5)); // not yet on disk

    const b = await openSession(backend, options);
    b.start(); // says hello → a replies with its commands
    await tick();
    expect(value(b)).toBe(5);

    b.session.dispatch(act.add(2));
    await tick();
    expect(value(a)).toBe(7);
    // Undo is per module across windows: a can undo b's latest action.
    a.session.undo('counter');
    await tick();
    expect(value(b)).toBe(5);
  });

  it('converges on two computers that edit concurrently and sync through files', async () => {
    const left = new MemoryBackend();
    await createVault(left);
    const right = new MemoryBackend();
    const link = new SyncLink(left, right);
    link.sync();

    const a = await openSession(left);
    const b = await openSession(right);
    a.session.dispatch(act.create('i1', 'from-a'));
    a.session.dispatch(act.add(1));
    b.session.dispatch(act.create('i1', 'from-b')); // conflicts with a's create
    b.session.dispatch(act.scale(3));
    await a.flush();
    await b.flush();
    link.sync();
    await a.pollNow();
    await b.pollNow();

    const sa = a.session.getState<CounterState>('counter');
    const sb = b.session.getState<CounterState>('counter');
    expect(sa).toEqual(sb);
    expect(a.session.runner.commands().map((c) => c.id)).toEqual(b.session.runner.commands().map((c) => c.id));
    expect(a.status.rejected).toBe(1);
    // Each writer only ever wrote its own file.
    expect(left.paths(LIVE_DIR)).toHaveLength(2);
  });

  it('turns read-only when another computer starts writing a newer command version', async () => {
    const backend = new MemoryBackend();
    await createVault(backend);
    const vs = await openSession(backend);
    await backend.write(
      `${LIVE_DIR}/2026-11-04.zz.0.jsonl`,
      `${JSON.stringify({ id: 'zz.1', t: 'ctr.Add', v: 7, at: Date.now() + 1000, p: {} })}\n`,
    );
    await vs.pollNow();
    expect(vs.status.readOnly).toBe('newerData');
    expect(vs.session.dispatch(act.add(1))).toMatchObject({ ok: false, reason: 'core.readOnly' });
  });
});
