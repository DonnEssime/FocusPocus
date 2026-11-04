<script lang="ts">
  import { focusActions, isSessionRunning, sessionEndsAt, type FocusState } from '@focuspocus/modules/focus';
  import Msg from '../../i18n/Msg.svelte';
  import { getSessionStore, getShell } from '../../shell/context';
  import { focusAudioFor } from './audio';
  import { formatCountdown } from './format';

  const store = getSessionStore();
  const shell = getShell();
  const audio = focusAudioFor(store);

  const focus = $derived(store.moduleState<FocusState>('focus'));
  let now = $state(Date.now());
  let playingId = $state(audio.playingSessionId);

  const session = $derived(isSessionRunning(focus.session, now) ? focus.session : null);
  const remaining = $derived(session ? sessionEndsAt(session) - now : focus.settings.durationMin * 60_000);
  const audioState = $derived(session ? (playingId === session.id ? 'playing' : 'silent') : 'idle');

  // Remaining time is always derived from the clock, never decremented.
  $effect(() => {
    void focus;
    now = Date.now();
  });
  $effect(() => {
    if (!session) return;
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  $effect(() => audio.sync(focus));
  $effect(() => audio.subscribe(() => (playingId = audio.playingSessionId)));
  $effect(() => {
    audio.prefetch('ticking', focus.settings.tickingSoundId);
    audio.prefetch('finishing', focus.settings.finishingSoundId);
  });

  function start(): void {
    audio.unlock(); // inside the click: satisfies the autoplay policy
    const result = shell.run(focusActions.start(focus.settings, Date.now()));
    if (!result.ok) return;
    const started = store.moduleState<FocusState>('focus').session;
    now = Date.now();
    if (started) void audio.playSession(started);
  }

  function stop(): void {
    if (!session) return;
    audio.stopSession();
    shell.run(focusActions.stop(session.id, Date.now()));
    now = Date.now();
  }
</script>

<div class="placeholder timer" data-audio={audioState}>
  <div class="countdown" data-testid="focus-countdown" class:running={session !== null}>{formatCountdown(remaining)}</div>
  {#if session}
    <button type="button" data-testid="focus-toggle" onclick={stop}><Msg key="focus.stop" /></button>
  {:else}
    <button type="button" class="primary" data-testid="focus-toggle" onclick={start}><Msg key="focus.start" /></button>
  {/if}
  {#if audioState === 'silent'}
    <p class="muted small" data-testid="focus-silent"><Msg key="focus.silentHere" /></p>
  {/if}
</div>
