import type { TimetrackState } from '@focuspocus/modules/timetrack';
import {
  addDays,
  addMonths,
  currentZone,
  daySequence,
  daysInMonth,
  logicalDayOf,
  monthStart,
  weekStart,
  type DayKey,
} from '@focuspocus/modules/timetrack/time';
import type { SessionStore } from '../../shell/sessionStore.svelte';

export type ViewKind = 'day' | 'week' | 'month';

/** How often "now" (running block, now line, today) refreshes. */
const TICK_MS = 15_000;

/**
 * UI state shared by the time tracker's panels: the selected view and date, the time zone and a
 * ticking "now". Navigating is not a command (it changes nothing in the vault), so this lives
 * here and is lost on reload.
 */
export class TimetrackUi {
  view = $state<ViewKind>('week');
  /** Any day inside the shown range; week and month views widen it. */
  anchor = $state<DayKey>('');
  zone = $state(currentZone());
  now = $state(Date.now());

  constructor(private readonly store: SessionStore) {
    this.anchor = this.today;
    const timer = setInterval(() => this.refresh(), TICK_MS);
    const onFocus = () => this.refresh();
    window.addEventListener('focus', onFocus);
    store.onDispose(() => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    });
  }

  /** Re-read the clock and the time zone (which changes when travelling). */
  refresh(): void {
    this.now = Date.now();
    this.zone = currentZone();
  }

  get state(): TimetrackState {
    return this.store.moduleState<TimetrackState>('timetrack');
  }

  get dayStartHour(): number {
    return this.state.dayWindow.startHour;
  }

  get today(): DayKey {
    return logicalDayOf(this.now, this.zone, this.dayStartHour);
  }

  /** Days shown by the Day and Week timelines. */
  get timelineDays(): DayKey[] {
    return this.view === 'day' ? [this.anchor] : daySequence(weekStart(this.anchor), 7);
  }

  /** The whole weeks covering the anchor's month, Monday first. */
  get monthGridDays(): DayKey[] {
    const first = monthStart(this.anchor);
    const gridStart = weekStart(first);
    const lead = daySequence(gridStart, 7).indexOf(first);
    return daySequence(gridStart, Math.ceil((lead + daysInMonth(first)) / 7) * 7);
  }

  /** The days whose totals the current view covers (statistics use the same range). */
  get rangeDays(): DayKey[] {
    if (this.view === 'month') {
      const first = monthStart(this.anchor);
      return daySequence(first, daysInMonth(first));
    }
    return this.timelineDays;
  }

  step(direction: 1 | -1): void {
    if (this.view === 'day') this.anchor = addDays(this.anchor, direction);
    else if (this.view === 'week') this.anchor = addDays(this.anchor, 7 * direction);
    else this.anchor = addMonths(monthStart(this.anchor), direction);
  }

  goToday(): void {
    this.refresh();
    this.anchor = this.today;
  }

  openDay(day: DayKey): void {
    this.anchor = day;
    this.view = 'day';
  }
}

const instances = new WeakMap<SessionStore, TimetrackUi>();

export function timetrackUiFor(store: SessionStore): TimetrackUi {
  let ui = instances.get(store);
  if (!ui) {
    ui = new TimetrackUi(store);
    instances.set(store, ui);
  }
  return ui;
}
