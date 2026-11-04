<script lang="ts">
  import { addMonths, daySequence, daysInMonth, monthStart, weekStart, type DayKey } from '@focuspocus/modules/timetrack/time';
  import { getLocale } from '../../i18n/locale.svelte';
  import { msgText } from '../../i18n/msg';
  import { formatDay } from './format';

  /** A month calendar for jumping to any date; ‹ › change the month, « » the year. */
  let { value, today, onpick }: { value: DayKey; today: DayKey; onpick: (day: DayKey) => void } = $props();

  // Starts at the selected month; browsing does not change the selection.
  // svelte-ignore state_referenced_locally
  let month = $state(monthStart(value));

  const days = $derived.by(() => {
    const start = weekStart(month);
    const lead = daySequence(start, 7).indexOf(month);
    return daySequence(start, Math.ceil((lead + daysInMonth(month)) / 7) * 7);
  });
  const weekdays = $derived(daySequence(weekStart(month), 7).map((d) => formatDay(d, getLocale(), { weekday: 'narrow' })));
</script>

<div class="datepicker" data-testid="tt-datepicker">
  <div class="datepicker-head">
    <button type="button" class="icon" aria-label={msgText('timetrack.nav.prevYear')} onclick={() => (month = addMonths(month, -12))}>«</button>
    <button type="button" class="icon" aria-label={msgText('timetrack.nav.prevMonth')} onclick={() => (month = addMonths(month, -1))}>‹</button>
    <span class="datepicker-label" data-testid="tt-datepicker-month">{formatDay(month, getLocale(), { month: 'long', year: 'numeric' })}</span>
    <button type="button" class="icon" aria-label={msgText('timetrack.nav.nextMonth')} onclick={() => (month = addMonths(month, 1))}>›</button>
    <button type="button" class="icon" aria-label={msgText('timetrack.nav.nextYear')} onclick={() => (month = addMonths(month, 12))}>»</button>
  </div>
  <div class="datepicker-grid">
    {#each weekdays as w, i (i)}<span class="muted small">{w}</span>{/each}
    {#each days as d (d)}
      <button
        type="button"
        class="datepicker-day"
        class:outside={monthStart(d) !== month}
        class:today={d === today}
        class:selected={d === value}
        data-day={d}
        onclick={() => onpick(d)}>{Number(d.slice(8))}</button
      >
    {/each}
  </div>
</div>
