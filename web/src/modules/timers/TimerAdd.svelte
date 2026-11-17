<script lang="ts">
  import { findPreset, TIMER_LABEL_MAX, timersActions, type TimersState } from '@focuspocus/modules/timers';
  import { formatLength, parseTimerInput } from '@focuspocus/modules/timers/parse';
  import Msg from '../../i18n/Msg.svelte';
  import { getLocale } from '../../i18n/locale.svelte';
  import { msgText } from '../../i18n/msg';
  import { getShell } from '../../shell/context';
  import { resolveSound, soundsOf } from '../../sounds/registry';
  import type { TimerAlarms } from './alarms';
  import { formatWhen } from './format';

  /**
   * The new-timer form: a length or clock time, an optional name and the alarm sound. Enter (or
   * Start) starts it; a length can also be saved to the quick list with the same name and sound.
   */
  let { timers, alarms }: { timers: TimersState; alarms: TimerAlarms } = $props();

  const shell = getShell();
  let when = $state('');
  let label = $state('');
  let whenInput: HTMLInputElement;
  let now = $state(Date.now());

  // The preview ("rings at 13:45, in 1h 30m") follows the clock while something is typed.
  $effect(() => {
    if (!when.trim()) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const parsed = $derived(when.trim() ? parseTimerInput(when, now) : null);
  const length = $derived(parsed?.ok && parsed.value.kind === 'length' ? parsed.value.ms : null);
  const soundId = $derived(resolveSound('finishing', timers.soundId).id);
  const saved = $derived(length !== null && findPreset(timers, length, label) !== undefined);
  const preview = $derived.by(() => {
    if (!parsed?.ok) return null;
    const v = parsed.value;
    if (v.kind === 'length') {
      return msgText('timers.new.previewLength', { length: formatLength(v.ms), time: formatWhen(now + v.ms, now, getLocale()) });
    }
    // Whole minutes: a clock time is not meant to the second.
    const left = Math.ceil((v.endsAt - now) / 60_000) * 60_000;
    return msgText('timers.new.previewAt', { time: formatWhen(v.endsAt, now, getLocale()), length: formatLength(left) });
  });

  function start(): void {
    const at = Date.now();
    const r = parseTimerInput(when, at);
    if (!r.ok) return;
    alarms.unlock(); // inside the click or key press: lets this window ring
    const endsAt = r.value.kind === 'length' ? at + r.value.ms : r.value.endsAt;
    if (shell.run(timersActions.start({ label: label.trim(), endsAt, soundId }, at)).ok) {
      when = '';
      label = '';
      whenInput.focus();
    }
  }

  function save(): void {
    if (length === null || saved) return;
    shell.run(timersActions.addPreset({ durationMs: length, label: label.trim(), soundId }));
  }

  function chooseSound(id: string): void {
    alarms.unlock();
    if (shell.run(timersActions.setSettings({ soundId: id })).ok) void alarms.playPreview(id);
  }
</script>

<form
  class="timer-add"
  onsubmit={(e) => {
    e.preventDefault();
    start();
  }}
>
  <div class="timer-add-row">
    <input
      bind:this={whenInput}
      class="timer-when-input"
      data-testid="timer-when"
      placeholder={msgText('timers.new.whenPlaceholder')}
      aria-label={msgText('timers.new.when')}
      aria-invalid={parsed !== null && !parsed.ok}
      autocomplete="off"
      bind:value={when}
    />
    <input
      class="timer-label-input"
      data-testid="timer-label"
      maxlength={TIMER_LABEL_MAX}
      placeholder={msgText('timers.new.labelPlaceholder')}
      aria-label={msgText('timers.new.label')}
      autocomplete="off"
      bind:value={label}
    />
    <button type="submit" class="primary" data-testid="timer-start" disabled={!parsed?.ok}><Msg key="timers.new.start" /></button>
  </div>
  <div class="timer-add-row">
    <label class="timer-sound">
      <span class="muted small"><Msg key="timers.new.sound" /></span>
      <select data-testid="timer-sound" value={soundId} onchange={(e) => chooseSound(e.currentTarget.value)}>
        {#each soundsOf('finishing') as sound (sound.id)}<option value={sound.id}>{msgText(sound.labelKey)}</option>{/each}
      </select>
    </label>
    <span class="spacer"></span>
    <button type="button" data-testid="timer-save" disabled={length === null || saved} onclick={save}>
      <Msg key={saved ? 'timers.new.saved' : 'timers.new.save'} />
    </button>
  </div>
  <p class="small timer-preview" data-testid="timer-preview">
    {#if parsed && !parsed.ok}
      <span class="error"><Msg key={parsed.reason} /></span>
    {:else if preview}
      {preview}
    {:else}
      <span class="muted"><Msg key="timers.new.hint" /></span>
    {/if}
  </p>
</form>
