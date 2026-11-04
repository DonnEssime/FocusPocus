<script lang="ts">
  import { timetrackActions, type TimetrackState } from '@focuspocus/modules/timetrack';
  import { balanceOver, formatBalance, formatClock, intervalBalance } from '@focuspocus/modules/timetrack/targets';
  import type { DayKey } from '@focuspocus/modules/timetrack/time';
  import { getLocale } from '../../i18n/locale.svelte';
  import Msg from '../../i18n/Msg.svelte';
  import { getShell } from '../../shell/context';
  import Popover from '../../shell/ui/Popover.svelte';
  import DatePicker from './DatePicker.svelte';
  import { formatDay } from './format';
  import type { TimetrackUi } from './ui.svelte';

  /** Balances: over the shown range, and over the configurable interval (§10.2 *Statistics*). */
  let { ui, tt }: { ui: TimetrackUi; tt: TimetrackState } = $props();
  const shell = getShell();

  const ctx = $derived({ zone: ui.zone, dayStartHour: ui.dayStartHour, now: ui.now });
  const shown = $derived.by(() => {
    const days = ui.rangeDays;
    return balanceOver(tt, days[0]!, days[days.length - 1]!, ctx);
  });
  const overall = $derived(intervalBalance(tt, ctx));
  const interval = $derived(tt.targets.interval);

  const dateLabel = (day: DayKey) => formatDay(day, getLocale(), { day: 'numeric', month: 'short', year: 'numeric' });

  let fromPopover: Popover;
  let toPopover: Popover;

  function setInterval(patch: Partial<{ from: DayKey | null; to: DayKey | null }>): void {
    shell.run(timetrackActions.setBalanceInterval({ ...interval, ...patch }));
    fromPopover.hide();
    toPopover.hide();
  }
</script>

<div class="target-stats" data-testid="tt-target-stats">
  <div class="stats-row" data-testid="tt-range-balance">
    {#if shown.first}
      <span class="muted small"><Msg key={`timetrack.targets.range.${ui.view}`} /></span>
      <span class="stats-figures small">
        <Msg key="timetrack.targets.figures" params={{ target: formatClock(shown.targetMs), tracked: formatClock(shown.trackedMs) }} />
      </span>
      <span class="balance" class:over={shown.balanceMs > 0} class:under={shown.balanceMs < 0} data-testid="tt-range-balance-value">
        {formatBalance(shown.balanceMs)}
      </span>
    {:else}
      <span class="muted small"><Msg key="timetrack.targets.rangeFuture" /></span>
    {/if}
  </div>

  <div class="stats-row overall">
    <span class="muted small"><Msg key="timetrack.targets.overall" /></span>
    <span
      class="balance big"
      class:over={overall.balanceMs > 0}
      class:under={overall.balanceMs < 0}
      data-testid="tt-overall-balance">{formatBalance(overall.balanceMs)}</span
    >
  </div>
  <div class="interval" data-testid="tt-interval">
    <button type="button" class="link" data-testid="tt-interval-from" popovertarget="tt-interval-from-popover">
      {#if interval.from}{dateLabel(interval.from)}{:else}<Msg key="timetrack.targets.beginning" />{/if}
    </button>
    <span class="muted">–</span>
    <button type="button" class="link" data-testid="tt-interval-to" popovertarget="tt-interval-to-popover">
      {#if interval.to}{dateLabel(interval.to)}{:else}<Msg key="timetrack.targets.now" />{/if}
    </button>
  </div>
  {#if overall.first}
    <p class="muted small" data-testid="tt-interval-days">
      <Msg key="timetrack.targets.counted" params={{ first: dateLabel(overall.first), last: dateLabel(overall.last!) }} />
    </p>
  {/if}

  <Popover id="tt-interval-from-popover" bind:this={fromPopover}>
    <div class="interval-picker">
      <button type="button" data-testid="tt-interval-beginning" onclick={() => setInterval({ from: null })}>
        <Msg key="timetrack.targets.beginning" />
      </button>
      <DatePicker value={interval.from ?? ui.today} today={ui.today} onpick={(day) => setInterval({ from: day })} />
    </div>
  </Popover>
  <Popover id="tt-interval-to-popover" bind:this={toPopover}>
    <div class="interval-picker">
      <button type="button" data-testid="tt-interval-now" onclick={() => setInterval({ to: null })}>
        <Msg key="timetrack.targets.now" />
      </button>
      <DatePicker value={interval.to ?? ui.today} today={ui.today} onpick={(day) => setInterval({ to: day })} />
    </div>
  </Popover>
</div>
