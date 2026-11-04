<script lang="ts">
  import type { MessageParams } from '@focuspocus/core/i18n/types';
  import type { AppMessageKey } from '@focuspocus/registry';
  import { onMount } from 'svelte';
  import Msg from '../i18n/Msg.svelte';
  import { loadVaultHandle } from '../storage/vaultPointer';
  import {
    devOpfsHandle,
    hasPermission,
    isFsAccessSupported,
    openVault,
    pickFolder,
    requestPermission,
    type OpenedVault,
    type OpenResult,
  } from './vaultOpening';

  let { onopen, autoOpen = true }: { onopen: (opened: OpenedVault) => void; autoOpen?: boolean } = $props();

  let phase = $state<'loading' | 'choose' | 'reopen' | 'unsupported'>('loading');
  let stored = $state<FileSystemDirectoryHandle | null>(null);
  let error = $state<{ key: AppMessageKey; params?: MessageParams } | null>(null);
  let busy = $state(false);

  onMount(async () => {
    const dev = await devOpfsHandle();
    if (dev) {
      await finish(openVault(dev, { remember: false }));
      return;
    }
    if (!isFsAccessSupported()) {
      phase = 'unsupported';
      return;
    }
    stored = await loadVaultHandle();
    if (stored && autoOpen && (await hasPermission(stored))) {
      if (await finish(openVault(stored, { remember: true }))) return;
    }
    phase = stored ? 'reopen' : 'choose';
  });

  async function finish(pending: Promise<OpenResult>): Promise<boolean> {
    const result = await pending;
    if (result.ok) {
      onopen(result.opened);
      return true;
    }
    error = result.params ? { key: result.error, params: result.params } : { key: result.error };
    if (phase === 'loading') phase = stored ? 'reopen' : 'choose';
    return false;
  }

  async function reopen(): Promise<void> {
    if (!stored) return;
    busy = true;
    error = null;
    try {
      if (!(await requestPermission(stored))) {
        error = { key: 'shell.picker.permissionDenied' };
        return;
      }
      await finish(openVault(stored, { remember: true }));
    } finally {
      busy = false;
    }
  }

  async function choose(): Promise<void> {
    busy = true;
    error = null;
    try {
      const handle = await pickFolder();
      if (handle) await finish(openVault(handle, { remember: true }));
    } catch (e) {
      error = { key: 'shell.picker.openFailed', params: { error: e instanceof Error ? e.message : String(e) } };
    } finally {
      busy = false;
    }
  }
</script>

<main class="picker">
  <div class="picker-card">
    <h1><Msg key="shell.appName" /></h1>
    {#if phase === 'loading'}
      <p class="muted"><Msg key="shell.picker.loading" /></p>
    {:else if phase === 'unsupported'}
      <p class="error"><Msg key="shell.picker.unsupported" /></p>
    {:else}
      <p><Msg key="shell.picker.intro" /></p>
      {#if phase === 'reopen' && stored}
        <button type="button" class="primary" disabled={busy} onclick={reopen}>
          <Msg key="shell.picker.reopen" params={{ name: stored.name }} />
        </button>
        <button type="button" disabled={busy} onclick={choose}><Msg key="shell.picker.chooseOther" /></button>
      {:else}
        <button type="button" class="primary" disabled={busy} onclick={choose}><Msg key="shell.picker.choose" /></button>
      {/if}
      <p class="muted small"><Msg key="shell.picker.chooseHint" /></p>
    {/if}
    {#if error}
      <p class="error" role="alert"><Msg key={error.key} params={error.params} /></p>
    {/if}
  </div>
</main>
