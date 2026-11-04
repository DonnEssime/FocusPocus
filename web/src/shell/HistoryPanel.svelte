<script lang="ts">
  import Msg from '../i18n/Msg.svelte';
  import { getSessionStore, getShell } from './context';

  /** Undo/redo buttons for one module's undo stack. Modules add it to their page as a small panel. */
  let { module }: { module: string } = $props();
  const store = getSessionStore();
  const shell = getShell();
</script>

<div class="history">
  <button type="button" data-testid="undo" disabled={!store.canUndo(module)} onclick={() => shell.undo(module)}>
    <Msg key="shell.undo" />
  </button>
  <button type="button" data-testid="redo" disabled={!store.canRedo(module)} onclick={() => shell.redo(module)}>
    <Msg key="shell.redo" />
  </button>
</div>
