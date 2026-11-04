import { describe, expect, it } from 'vitest';
import { Session } from '../src/core/session';
import { allBlocks, getBlock, trackedBefore } from '../src/modules/timetrack/blocks';
import { timetrackActions as tt, timetrackModule, type TimetrackState } from '../src/modules/timetrack';
import { rangeTotals } from '../src/modules/timetrack/stats';
import {
  balanceOver,
  dayTarget,
  formatBalance,
  fulltimeOn,
  intervalBalance,
  parseClock,
  parseTarget,
  targetMs,
  targetSum,
  type BalanceContext,
} from '../src/modules/timetrack/targets';
import { rng } from './helpers/test-modules';

const H = 3_600_000;
const M = 60_000;
const BXL = 'Europe/Brussels';
/** Wednesday 4 Nov 2026, 14:30 in Brussels. */
const NOW = Date.UTC(2026, 10, 4, 13, 30);
/** 07:00 Brussels on 4 Nov (logical day start). */
const D4 = Date.UTC(2026, 10, 4, 6);

function session(now = NOW) {
  let t = now;
  const s = new Session({ modules: [timetrackModule], writerId: 'wa', now: () => t++ });
  return { s, set: (ms: number) => (t = ms) };
}
const state = (s: Session) => s.getState<TimetrackState>('timetrack');
const ctx = (now = NOW): BalanceContext => ({ zone: BXL, dayStartHour: 7, now });

describe('parsing and formatting', () => {
  it('accepts hh:mm and percentages within range, and nothing else', () => {
    expect(parseTarget('6:30')).toEqual({ ms: 6.5 * H });
    expect(parseTarget(' 06:30 ')).toEqual({ ms: 6.5 * H });
    expect(parseTarget('24:00')).toEqual({ ms: 24 * H });
    expect(parseTarget('75%')).toEqual({ percent: 75 });
    expect(parseTarget('62.5 %')).toEqual({ percent: 62.5 });
    expect(parseTarget('62,5%')).toEqual({ percent: 62.5 });
    for (const bad of ['24:01', '6:60', '6', '6h', '301%', '-5%', '', 'abc', '1:2']) expect(parseTarget(bad), bad).toBeNull();
    expect(parseClock('8:00')).toBe(8 * H);
    expect(parseClock('0:00')).toBeNull();
    expect(formatBalance(-1.75 * H)).toBe('−1:45');
    expect(formatBalance(0.25 * H)).toBe('+0:15');
    expect(formatBalance(20_000)).toBe('0:00');
  });
});

describe('target commands', () => {
  it('sets day targets as percent or duration; zero clears; invalid ones are rejected', () => {
    const { s } = session();
    expect(s.dispatch(tt.setDayTarget('2026-11-04', { percent: 50 })).ok).toBe(true);
    expect(targetMs(state(s).targets, '2026-11-04')).toBe(4 * H);
    expect(s.dispatch(tt.setDayTarget('2026-11-05', { ms: 6.5 * H })).ok).toBe(true);
    expect(state(s).targets.days).toEqual(['2026-11-04', '2026-11-05']);
    s.dispatch(tt.setDayTarget('2026-11-04', { percent: 0 }));
    expect(dayTarget(state(s).targets, '2026-11-04')).toBeNull();
    expect(state(s).targets.days).toEqual(['2026-11-05']);
    for (const bad of [
      tt.setDayTarget('2026-02-30', { ms: H }),
      tt.setDayTarget('2026-11-04', { ms: 25 * H }),
      tt.setDayTarget('2026-11-04', { ms: 1 }),
      tt.setDayTarget('2026-11-04', { percent: 400 }),
      tt.setDayTarget('2026-11-04', { percent: 10, ms: H } as never),
    ]) {
      expect(s.dispatch(bad)).toMatchObject({ ok: false, reason: 'timetrack.error.invalidTarget' });
    }
    s.undo('timetrack');
    expect(targetMs(state(s).targets, '2026-11-04')).toBe(4 * H);
  });

  it('applies new full-time hours going forward or retroactively; hh:mm targets never change', () => {
    const { s } = session();
    s.dispatch(tt.setDayTarget('2026-10-01', { percent: 100 }));
    s.dispatch(tt.setDayTarget('2026-12-01', { percent: 100 }));
    s.dispatch(tt.setDayTarget('2026-12-02', { ms: 3 * H }));
    s.dispatch(tt.setTargetSettings({ fulltimeMs: 6 * H, applyFrom: '2026-11-04' }));
    const t = () => state(s).targets;
    expect([targetMs(t(), '2026-10-01'), targetMs(t(), '2026-12-01'), targetMs(t(), '2026-12-02')]).toEqual([8 * H, 6 * H, 3 * H]);
    // A second "going forward" change replaces later entries, keeps earlier ones.
    s.dispatch(tt.setTargetSettings({ fulltimeMs: 7 * H, applyFrom: '2026-11-01' }));
    expect(t().fulltime).toEqual([{ from: '', ms: 8 * H }, { from: '2026-11-01', ms: 7 * H }]);
    s.dispatch(tt.setTargetSettings({ fulltimeMs: 5 * H, applyFrom: null }));
    expect([targetMs(t(), '2026-10-01'), targetMs(t(), '2026-12-02')]).toEqual([5 * H, 3 * H]);
    expect(fulltimeOn(t(), '1999-01-01')).toBe(5 * H);
    s.undo('timetrack');
    expect(targetMs(t(), '2026-10-01')).toBe(8 * H);
    expect(s.dispatch(tt.setTargetSettings({ fulltimeMs: 0 }))).toMatchObject({ reason: 'timetrack.error.invalidFulltime' });
  });

  it('switching targets off keeps all target data', () => {
    const { s } = session();
    s.dispatch(tt.setTargetSettings({ enabled: true }));
    s.dispatch(tt.setDayTarget('2026-11-04', { percent: 100 }));
    s.dispatch(tt.setTargetSettings({ enabled: false }));
    expect(state(s).targets.enabled).toBe(false);
    expect(targetMs(state(s).targets, '2026-11-04')).toBe(8 * H);
  });

  it('validates the balance interval', () => {
    const { s } = session();
    expect(s.dispatch(tt.setBalanceInterval({ from: '2026-11-04', to: '2026-11-01' }))).toMatchObject({
      reason: 'timetrack.error.intervalOrder',
    });
    expect(s.dispatch(tt.setBalanceInterval({ from: '2026-11-01', to: null })).ok).toBe(true);
    expect(state(s).targets.interval).toEqual({ from: '2026-11-01', to: null });
  });
});

describe('balances', () => {
  it('is tracked minus targets over whole days up to today; future days never count', () => {
    const { s } = session();
    // Monday 2 Nov: target 100 %, worked 9 h. Tuesday: no target, worked 1 h. Wednesday (today):
    // target 8 h, worked 2 h so far. Thursday (future): target 100 %.
    s.dispatch(tt.setDayTarget('2026-11-02', { percent: 100 }));
    s.dispatch(tt.setDayTarget('2026-11-04', { ms: 8 * H }));
    s.dispatch(tt.setDayTarget('2026-11-05', { percent: 100 }));
    s.dispatch(tt.createBlock({ startMs: D4 - 48 * H + H, endMs: D4 - 48 * H + 10 * H, title: '', tagIds: [] }));
    s.dispatch(tt.createBlock({ startMs: D4 - 24 * H + 18 * H, endMs: D4 - 24 * H + 19 * H, title: '', tagIds: [] }));
    s.dispatch(tt.createBlock({ startMs: D4 + H, endMs: D4 + 3 * H, title: '', tagIds: [] }));
    const week = balanceOver(state(s), '2026-11-02', '2026-11-08', ctx());
    expect(week).toEqual({ first: '2026-11-02', last: '2026-11-04', trackedMs: 12 * H, targetMs: 16 * H, balanceMs: -4 * H });
    expect(balanceOver(state(s), '2026-11-05', '2026-11-08', ctx()).first).toBeNull();
    // A late block (02:00 on 5 Nov) still belongs to the 4 Nov day.
    s.dispatch(tt.createBlock({ startMs: D4 + 19 * H, endMs: D4 + 20 * H, title: '', tagIds: [] }));
    expect(balanceOver(state(s), '2026-11-04', '2026-11-04', ctx(D4 + 21 * H)).trackedMs).toBe(3 * H);
  });

  it('counts the running block up to now', () => {
    const { s } = session();
    s.dispatch(tt.startTracking({ startMs: NOW - 2 * H, title: '', tagIds: [] }));
    expect(balanceOver(state(s), '2026-11-04', '2026-11-04', ctx()).trackedMs).toBe(2 * H);
    expect(balanceOver(state(s), '2026-11-04', '2026-11-04', ctx(NOW + H)).trackedMs).toBe(3 * H);
  });

  it('the interval starts at the first active day by default, or where it is set', () => {
    const { s } = session();
    s.dispatch(tt.setDayTarget('2026-10-30', { percent: 100 }));
    s.dispatch(tt.createBlock({ startMs: D4 + H, endMs: D4 + 2 * H, title: '', tagIds: [] }));
    expect(intervalBalance(state(s), ctx())).toMatchObject({ first: '2026-10-30', last: '2026-11-04', balanceMs: -7 * H });
    s.dispatch(tt.setBalanceInterval({ from: '2026-11-01', to: null }));
    expect(intervalBalance(state(s), ctx())).toMatchObject({ first: '2026-11-01', balanceMs: H });
    s.dispatch(tt.setBalanceInterval({ from: '2026-10-01', to: '2026-10-31' }));
    expect(intervalBalance(state(s), ctx())).toMatchObject({ last: '2026-10-31', balanceMs: -8 * H });
  });

  it('the fast tracked-time query matches a plain range scan', () => {
    const random = rng(3);
    let t = Date.UTC(2025, 0, 1);
    const s = new Session({ modules: [timetrackModule], writerId: 'wa', now: () => t });
    for (let i = 0; i < 2_000; i++) {
      const start = Date.UTC(2025, 0, 1) + Math.floor(random() * 600 * 24) * H;
      t = start + 50 * H;
      s.dispatch(tt.createBlock({ startMs: start, endMs: start + Math.ceil(random() * 30) * 15 * M, title: '', tagIds: [] }));
    }
    s.dispatch(tt.startTracking({ startMs: t - H, title: '', tagIds: [] }));
    const st = state(s);
    const running = getBlock(st.blocks, st.runningId!);
    expect([...allBlocks(st.blocks)].length).toBeGreaterThan(500);
    for (let i = 0; i < 300; i++) {
      const a = Date.UTC(2025, 0, 1) + random() * 700 * 24 * H;
      const b = a + random() * 120 * 24 * H;
      const fast = trackedBefore(st.blocks, b, t, running) - trackedBefore(st.blocks, a, t, running);
      expect(fast).toBe(rangeTotals(st, a, b, t).totalMs);
    }
  });

  it('a balance over ten years takes milliseconds', () => {
    let t = Date.UTC(2016, 0, 1);
    const s = new Session({ modules: [timetrackModule], writerId: 'wa', now: () => t });
    for (let day = 0; day < 3_650; day++) {
      const base = Date.UTC(2016, 0, 1, 8) + day * 24 * H;
      t = base + 12 * H;
      for (let k = 0; k < 10; k++) {
        s.dispatch(tt.createBlock({ startMs: base + k * 0.8 * H, endMs: base + (k * 0.8 + 0.75) * H, title: '', tagIds: [] }));
      }
      if (day % 7 < 5) {
        const key = new Date(base).toISOString().slice(0, 10);
        s.dispatch(tt.setDayTarget(key, { percent: 100 }));
      }
    }
    const st = state(s);
    const c = { zone: BXL, dayStartHour: 7, now: t };
    intervalBalance(st, c); // warm-up
    const begin = performance.now();
    const b = intervalBalance(st, c);
    const ms = performance.now() - begin;
    console.info(`[benchmark] ${st.blocks.where.size} blocks, ${st.targets.days.length} targets: interval balance ${ms.toFixed(2)} ms`);
    expect(b.trackedMs).toBe(3_650 * 7.5 * H);
    expect(b.targetMs).toBe(targetSum(st.targets, '2016-01-01', '2026-12-31'));
    expect(ms).toBeLessThan(5);
  }, 30_000);
});
