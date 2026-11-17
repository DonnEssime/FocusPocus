<script lang="ts">
  import { isFinished, timersActions, type Timer } from '@focuspocus/modules/timers';
  import Msg from '../../i18n/Msg.svelte';
  import { getLocale } from '../../i18n/locale.svelte';
  import { msgText } from '../../i18n/msg';
  import { getShell } from '../../shell/context';
  import { formatCountdown, formatWhen } from './format';

  /** One timer: counting down with a cancel button, or finished with a dismiss button. */
  let { timer, now }: { timer: Timer; now: number } = $props();

  const shell = getShell();
  const finished = $derived(isFinished(timer, now));
  const when = $derived(formatWhen(timer.endsAt, now, getLocale()));
  const name = $derived(timer.label || when);
  const progress = $derived(Math.min(1, Math.max(0, (now - timer.startedAt) / (timer.endsAt - timer.startedAt))));
</script>

<li class="timer-row" class:finished data-testid="timer" data-state={finished ? 'finished' : 'running'}>
  <div class="timer-main">
    {#if timer.label}<span class="timer-name" data-testid="timer-name">{timer.label}</span>{/if}
    <span class="muted small" data-testid="timer-ends">
      <Msg key={finished ? 'timers.finishedAt' : 'timers.endsAt'} params={{ time: when }} />
    </span>
  </div>
  {#if finished}
    <button
      type="button"
      class="primary"
      data-testid="timer-dismiss"
      aria-label={msgText('timers.dismissLabel', { name })}
      onclick={() => shell.run(timersActions.remove(timer.id))}><Msg key="timers.dismiss" /></button
    >
  {:else}
    <span class="timer-countdown" data-testid="timer-countdown">{formatCountdown(timer.endsAt - now)}</span>
    <button
      type="button"
      class="icon timer-cancel"
      data-testid="timer-cancel"
      aria-label={msgText('timers.cancel', { name })}
      title={msgText('timers.cancel', { name })}
      onclick={() => shell.run(timersActions.remove(timer.id))}>✕</button
    >
  {/if}
  <div class="timer-progress" style:--progress={progress}></div>
</li>
