<script lang="ts">
  import type { AppMessageKey } from '@focuspocus/registry';
  import type { Component } from 'svelte';
  import Msg from '../i18n/Msg.svelte';
  import { msgText } from '../i18n/msg';
  import { getSessionStore, getShell } from './context';
  import Modal from './ui/Modal.svelte';

  /**
   * Undo/redo buttons for one module's undo stack. Modules add it to their page as a small panel.
   * A module may also pass its settings component: a gear button then opens it in a pop-up.
   */
  let {
    module,
    settings,
    settingsTitle = 'shell.settings',
  }: { module: string; settings?: Component; settingsTitle?: AppMessageKey } = $props();
  const store = getSessionStore();
  const shell = getShell();
  let settingsOpen = $state(false);
</script>

<div class="history">
  <button type="button" data-testid="undo" disabled={!store.canUndo(module)} onclick={() => shell.undo(module)}>
    <Msg key="shell.undo" />
  </button>
  <button type="button" data-testid="redo" disabled={!store.canRedo(module)} onclick={() => shell.redo(module)}>
    <Msg key="shell.redo" />
  </button>
  {#if settings}
    {@const Settings = settings}
    <button
      type="button"
      class="icon history-settings"
      data-testid="module-settings"
      aria-label={msgText(settingsTitle)}
      title={msgText(settingsTitle)}
      onclick={() => (settingsOpen = true)}>⚙</button
    >
    <!-- Settings apply as they change (each is its own undoable command); the pop-up only closes. -->
    <Modal
      open={settingsOpen}
      titleKey={settingsTitle}
      oncancel={() => (settingsOpen = false)}
      onsubmit={() => (settingsOpen = false)}
      testid="settings-dialog"
    >
      <Settings />
      {#snippet actions()}
        <button type="submit" class="primary" data-testid="settings-close"><Msg key="shell.close" /></button>
      {/snippet}
    </Modal>
  {/if}
</div>
