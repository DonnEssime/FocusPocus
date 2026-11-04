<script lang="ts">
  import { FOCUS_DURATION_MAX, FOCUS_DURATION_MIN, focusActions, type FocusState } from '@focuspocus/modules/focus';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getSessionStore, getShell } from '../../shell/context';
  import { focusAudioFor } from './audio';
  import { resolveSound, soundsOf, type SoundKind } from './sounds';

  const store = getSessionStore();
  const shell = getShell();
  const audio = focusAudioFor(store);
  const settings = $derived(store.moduleState<FocusState>('focus').settings);

  const tickingId = $derived(resolveSound('ticking', settings.tickingSoundId).id);
  const finishingId = $derived(resolveSound('finishing', settings.finishingSoundId).id);

  /** Commit on `change` (not per keystroke): one command, one undo step. */
  function commitDuration(input: HTMLInputElement): void {
    const value = Number(input.value);
    if (value === settings.durationMin) return;
    const result = shell.run(focusActions.setSettings({ durationMin: value }));
    if (!result.ok) input.value = String(settings.durationMin);
  }

  function chooseSound(kind: SoundKind, id: string): void {
    audio.unlock();
    const patch = kind === 'ticking' ? { tickingSoundId: id } : { finishingSoundId: id };
    if (shell.run(focusActions.setSettings(patch)).ok) void audio.playPreview(kind, id);
  }
</script>

<form class="settings" onsubmit={(e) => e.preventDefault()}>
  <label>
    <span><Msg key="focus.settings.duration" /></span>
    <input
      data-testid="focus-duration"
      type="number"
      min={FOCUS_DURATION_MIN}
      max={FOCUS_DURATION_MAX}
      step="1"
      value={settings.durationMin}
      onchange={(e) => commitDuration(e.currentTarget)}
    />
  </label>
  <label>
    <span><Msg key="focus.settings.tickingSound" /></span>
    <select data-testid="focus-ticking" value={tickingId} onchange={(e) => chooseSound('ticking', e.currentTarget.value)}>
      {#each soundsOf('ticking') as sound (sound.id)}<option value={sound.id}>{msgText(sound.labelKey)}</option>{/each}
    </select>
  </label>
  <label>
    <span><Msg key="focus.settings.finishingSound" /></span>
    <select
      data-testid="focus-finishing"
      value={finishingId}
      onchange={(e) => chooseSound('finishing', e.currentTarget.value)}
    >
      {#each soundsOf('finishing') as sound (sound.id)}<option value={sound.id}>{msgText(sound.labelKey)}</option>{/each}
    </select>
  </label>
  <p class="muted small"><Msg key="focus.settings.previewHint" /></p>
</form>
