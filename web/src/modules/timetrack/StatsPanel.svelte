<script lang="ts">
  import type { TimetrackState } from '@focuspocus/modules/timetrack';
  import { NO_TAG, rangeTotals, totalsSlices } from '@focuspocus/modules/timetrack/stats';
  import { dayRange } from '@focuspocus/modules/timetrack/time';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getSessionStore } from '../../shell/context';
  import { tagColor } from './colors';
  import { formatDuration } from './format';
  import Pie from './Pie.svelte';
  import TargetStats from './TargetStats.svelte';
  import { timetrackUiFor } from './ui.svelte';

  /** Statistics for exactly the range the time view shows (that day, week or month). */
  const store = getSessionStore();
  const ui = timetrackUiFor(store);
  const tt = $derived(store.moduleState<TimetrackState>('timetrack'));

  const totals = $derived.by(() => {
    const days = ui.rangeDays;
    const from = dayRange(days[0]!, ui.zone, ui.dayStartHour).from;
    const to = dayRange(days[days.length - 1]!, ui.zone, ui.dayStartHour).to;
    return rangeTotals(tt, from, to, ui.now);
  });

  const rows = $derived(
    totalsSlices(totals).map((s) => {
      const tag = s.key === NO_TAG ? undefined : tt.tags[s.key];
      return { ...s, color: tagColor(tag), name: tag ? tag.name : msgText('timetrack.tag.none') };
    }),
  );
</script>

<div class="stats" data-testid="tt-stats">
  {#if tt.targets.enabled}<TargetStats {ui} {tt} />{/if}
  <div class="stats-total">
    <span class="muted small"><Msg key={`timetrack.stats.total.${ui.view}`} /></span>
    <span class="stats-total-value" data-testid="tt-stats-total">{formatDuration(totals.totalMs)}</span>
  </div>
  {#if rows.length >= 2}
    <div class="stats-pie" data-testid="tt-stats-pie"><Pie slices={rows} label={msgText('timetrack.stats.pieLabel')} /></div>
  {/if}
  {#if rows.length}
    <ul class="stats-legend">
      {#each rows as row (row.key)}
        <li data-testid="tt-stats-row" data-key={row.key}>
          <span class="tag-dot" style:background={row.color}></span>
          <span class="stats-name">{row.name}</span>
          <span class="stats-hours">{formatDuration(row.ms)}</span>
          <span class="stats-share muted">{Math.round(row.share * 100)}%</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted small"><Msg key="timetrack.stats.empty" /></p>
  {/if}
</div>
