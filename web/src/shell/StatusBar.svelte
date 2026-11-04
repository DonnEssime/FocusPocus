<script lang="ts">
  import Msg from '../i18n/Msg.svelte';
  import { getSessionStore } from './context';

  let { vaultName, onclose }: { vaultName: string; onclose: () => void } = $props();
  const store = getSessionStore();
  const status = $derived(store.status);
  const build = __BUILD_INFO__;
</script>

<footer class="status-bar">
  <span data-testid="vault-name"><Msg key="shell.status.vault" params={{ name: vaultName }} /></span>
  <span class="status" data-testid="save-status">
    {#if status.readOnly}
      <span class="warning">
        <Msg key={status.readOnly === 'newerFormat' ? 'shell.status.readOnly.newerFormat' : 'shell.status.readOnly.newerData'} />
      </span>
      <button type="button" class="link" onclick={() => location.reload()}><Msg key="shell.status.reload" /></button>
    {:else if status.error}
      <span class="danger"><Msg key="shell.status.error" /></span>
    {:else if status.pending > 0 || status.saving}
      <Msg key="shell.status.pending" />
    {:else}
      <Msg key="shell.status.saved" />
    {/if}
  </span>
  {#if status.rejected > 0}
    <span class="warning"><Msg key="shell.status.rejected" params={{ count: status.rejected }} /></span>
  {/if}
  <span class="spacer"></span>
  <button type="button" class="link" onclick={onclose}><Msg key="shell.status.closeVault" /></button>
  <span class="muted" title={build.date}>v{build.version} · {build.commit}</span>
</footer>
