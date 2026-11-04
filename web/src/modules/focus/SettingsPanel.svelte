<script lang="ts">
  import { FOCUS_DURATION_MAX, FOCUS_DURATION_MIN, focusActions, type FocusState } from '@focuspocus/modules/focus';
  import Msg from '../../i18n/Msg.svelte';
  import { getSessionStore, getShell } from '../../shell/context';

  const store = getSessionStore();
  const shell = getShell();
  const settings = $derived(store.moduleState<FocusState>('focus').settings);

  /** Commit on `change` (not per keystroke): one command, one undo step. */
  function commitDuration(input: HTMLInputElement): void {
    const value = Number(input.value);
    if (value === settings.durationMin) return;
    const result = shell.run(focusActions.setSettings({ durationMin: value }));
    if (!result.ok) input.value = String(settings.durationMin);
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
</form>
