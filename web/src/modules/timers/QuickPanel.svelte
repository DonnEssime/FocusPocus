<script lang="ts">
  import { timersActions, type TimersState } from '@focuspocus/modules/timers';
  import { formatLength } from '@focuspocus/modules/timers/parse';
  import Msg from '../../i18n/Msg.svelte';
  import { msgText } from '../../i18n/msg';
  import { getSessionStore, getShell } from '../../shell/context';
  import { resolveSound } from '../../sounds/registry';
  import { timerAlarmsFor } from './alarms';

  /** The user's own list of common lengths: one click starts a timer with its name and sound. */
  const store = getSessionStore();
  const shell = getShell();
  const alarms = timerAlarmsFor(store);
  const presets = $derived(store.moduleState<TimersState>('timers').presets);
</script>

{#if presets.length === 0}
  <p class="muted small" data-testid="quick-empty"><Msg key="timers.quick.empty" /></p>
{:else}
  <ul class="quick-list">
    {#each presets as preset (preset.id)}
      {@const name = preset.label ? `${formatLength(preset.durationMs)} ${preset.label}` : formatLength(preset.durationMs)}
      <li class="quick-row" data-testid="quick-timer">
        <button
          type="button"
          class="quick-start"
          data-testid="quick-start"
          aria-label={msgText('timers.quick.start', { name })}
          title={msgText(resolveSound('finishing', preset.soundId).labelKey)}
          onclick={() => {
            alarms.unlock();
            shell.run(timersActions.startPreset(preset, Date.now()));
          }}
        >
          <span class="quick-length">{formatLength(preset.durationMs)}</span>
          {#if preset.label}<span class="quick-label">{preset.label}</span>{/if}
        </button>
        <button
          type="button"
          class="icon quick-delete"
          data-testid="quick-delete"
          aria-label={msgText('timers.quick.delete', { name })}
          title={msgText('timers.quick.delete', { name })}
          onclick={() => shell.run(timersActions.deletePreset(preset.id))}>✕</button
        >
      </li>
    {/each}
  </ul>
{/if}
