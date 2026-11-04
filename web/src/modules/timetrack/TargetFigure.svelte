<script lang="ts">
  import { formatBalance, formatClock } from '@focuspocus/modules/timetrack/targets';
  import { msgText } from '../../i18n/msg';
  import type { DayTargetView } from './targetView';

  /**
   * A day's target figure, `worked / target → balance`, with the balance coloured (over / under).
   * A future day shows its target only; a day that doesn't count shows `empty`.
   */
  let { view, empty = '–' }: { view: DayTargetView; empty?: string } = $props();
</script>

<span class="target-figure" data-testid="tt-target-figure"
  >{#if view.future && view.targetMs > 0}{msgText('timetrack.targets.chipFuture', { target: formatClock(view.targetMs) })}{:else if view.counts}{msgText(
      'timetrack.targets.chipWork',
      { tracked: formatClock(view.trackedMs), target: formatClock(view.targetMs) },
    )} → <span class="balance" class:over={view.balanceMs > 0} class:under={view.balanceMs < 0} data-testid="tt-target-balance"
      >{formatBalance(view.balanceMs)}</span
    >{:else}{empty}{/if}</span
>
