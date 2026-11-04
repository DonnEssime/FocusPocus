<script lang="ts">
  import type { TimetrackState } from '@focuspocus/modules/timetrack';
  import { dayTotals, NO_TAG, totalsSlices } from '@focuspocus/modules/timetrack/stats';
  import { daySequence, monthStart, weekStart } from '@focuspocus/modules/timetrack/time';
  import { getLocale } from '../../i18n/locale.svelte';
  import { tagColor } from './colors';
  import { formatDay, formatDuration } from './format';
  import Pie, { type PieSlice } from './Pie.svelte';
  import TargetFigure from './TargetFigure.svelte';
  import { dayTargetView } from './targetView';
  import type { TimetrackUi } from './ui.svelte';

  let { ui, tt }: { ui: TimetrackUi; tt: TimetrackState } = $props();

  /** Pie area grows with hours; 12 h fills the cell, so months can be compared at a glance. */
  const FULL_HOURS = 12;
  const MAX_RADIUS = 46;

  const month = $derived(monthStart(ui.anchor));
  const days = $derived(ui.monthGridDays);
  const totals = $derived(dayTotals(tt, days.filter((d) => monthStart(d) === month), ui.zone, ui.dayStartHour, ui.now));
  const weekdays = $derived(daySequence(weekStart(month), 7).map((d) => formatDay(d, getLocale(), { weekday: 'short' })));

  function slices(day: string): PieSlice[] {
    const t = totals.get(day);
    if (!t) return [];
    return totalsSlices(t).map((s) => ({
      key: s.key,
      share: s.share,
      color: tagColor(s.key === NO_TAG ? undefined : tt.tags[s.key]),
    }));
  }

  function radius(ms: number): number {
    return MAX_RADIUS * Math.sqrt(Math.min(ms / 3_600_000, FULL_HOURS) / FULL_HOURS);
  }
</script>

<div class="month" data-testid="tt-month">
  {#each weekdays as w, i (i)}<div class="month-weekday muted small">{w}</div>{/each}
  {#each days as day (day)}
    {@const total = totals.get(day)}
    {#if total}
      <button
        type="button"
        class="month-cell"
        class:today={day === ui.today}
        data-testid="tt-month-day"
        data-day={day}
        onclick={() => ui.openDay(day)}
      >
        <span class="month-date">{Number(day.slice(8))}</span>
        {#if tt.targets.enabled}
          <!-- Same figure as the Day view chip; days that don't count stay empty to keep the grid calm. -->
          <span class="month-target"><TargetFigure view={dayTargetView(tt, day, ui)} empty="" /></span>
        {:else if total.totalMs > 0}
          <span class="month-total" data-testid="tt-month-total">{formatDuration(total.totalMs)}</span>
        {/if}
        {#if total.totalMs > 0}
          <span class="month-pie"><Pie slices={slices(day)} radius={radius(total.totalMs)} /></span>
        {/if}
      </button>
    {:else}
      <div class="month-cell outside" aria-hidden="true"><span class="month-date">{Number(day.slice(8))}</span></div>
    {/if}
  {/each}
</div>
