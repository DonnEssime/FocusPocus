<script lang="ts">
  import { timersByEnd, type TimersState } from '@focuspocus/modules/timers';
  import Msg from '../../i18n/Msg.svelte';
  import { getSessionStore } from '../../shell/context';
  import { timerAlarmsFor } from './alarms';
  import TimerAdd from './TimerAdd.svelte';
  import TimerRow from './TimerRow.svelte';
  import './timers.css';

  const store = getSessionStore();
  const alarms = timerAlarmsFor(store);
  const timers = $derived(store.moduleState<TimersState>('timers'));
  const list = $derived(timersByEnd(timers));
  let now = $state(Date.now());
  const running = $derived(list.some((t) => t.endsAt > now));

  let leader = $state(alarms.leader);
  let audioReady = $state(alarms.audioReady);
  let rings = $state(alarms.rings);

  // Remaining time is always derived from the clock, never decremented.
  $effect(() => {
    void timers;
    now = Date.now();
  });
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  // The tab stays mounted while hidden (§6), so this window keeps ringing from any tab.
  $effect(() => alarms.sync(timers));
  $effect(() =>
    alarms.subscribe(() => {
      leader = alarms.leader;
      audioReady = alarms.audioReady;
      rings = alarms.rings;
    }),
  );
</script>

<div class="timers" data-testid="timers-panel" data-alarm={leader ? 'leader' : 'follower'} data-rings={rings}>
  <TimerAdd {timers} {alarms} />
  {#if running && !audioReady}
    <p class="warning small" data-testid="timers-audio-locked"><Msg key="timers.audioLocked" /></p>
  {/if}
  {#if list.length === 0}
    <p class="muted small" data-testid="timers-empty"><Msg key="timers.empty" /></p>
  {:else}
    <ul class="timer-list">
      {#each list as timer (timer.id)}
        <TimerRow {timer} {now} />
      {/each}
    </ul>
  {/if}
</div>
