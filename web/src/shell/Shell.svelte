<script lang="ts">
  import { resolveLocale } from '@focuspocus/core/i18n/locales';
  import type { MessageParams } from '@focuspocus/core/i18n/types';
  import type { Action } from '@focuspocus/core/session';
  import type { AppState } from '@focuspocus/modules/app';
  import { onDestroy, onMount } from 'svelte';
  import { setLocale } from '../i18n/locale.svelte';
  import Msg from '../i18n/Msg.svelte';
  import { msgText } from '../i18n/msg';
  import { MODULE_TITLES, PANELS } from '../modules';
  import { applyTheme } from '../theme/applyTheme';
  import { resolveTheme } from '../theme/registry';
  import { setSessionStore, setShell } from './context';
  import LayoutHost from './LayoutHost.svelte';
  import { DEFAULT_LAYOUT, firstPanel } from './layout';
  import { SessionStore } from './sessionStore.svelte';
  import StatusBar from './StatusBar.svelte';
  import type { OpenedVault } from './vaultOpening';

  let { opened, onclose }: { opened: OpenedVault; onclose: () => void } = $props();

  // Shell is re-created per vault ({#key} in App), so capturing `opened` once is intended.
  // svelte-ignore state_referenced_locally
  const store = new SessionStore(opened.vs);
  setSessionStore(store);

  const initialPanel = firstPanel(DEFAULT_LAYOUT);
  let activeModule = $state((initialPanel && PANELS.get(initialPanel)?.module) || 'app');

  interface Toast {
    id: number;
    text: string;
  }
  let toasts = $state<Toast[]>([]);
  let toastSeq = 0;

  function toast(key: string, params?: MessageParams): void {
    const id = ++toastSeq;
    toasts = [...toasts, { id, text: msgText(key, params) }];
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 4000);
  }

  function run(action: Action) {
    const result = store.dispatch(action);
    if (!result.ok) toast(result.reason, result.params);
    return result;
  }

  setShell({ setActiveModule: (id) => (activeModule = id), run });

  const appState = $derived(store.moduleState<AppState>('app'));
  $effect(() => applyTheme(resolveTheme(appState.themeId)));
  $effect(() => setLocale(resolveLocale(appState.locale)));

  const canUndo = $derived(store.canUndo(activeModule));
  const canRedo = $derived(store.canRedo(activeModule));
  const scopeTitle = $derived(MODULE_TITLES[activeModule]);

  function undo(): void {
    const r = opened.vs.session.undo(activeModule);
    if (!r.ok) toast(r.reason, r.params);
  }

  function redo(): void {
    const r = opened.vs.session.redo(activeModule);
    if (!r.ok) toast(r.reason, r.params);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (canUndo) undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      if (canRedo) redo();
    }
  }

  onMount(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void opened.vs.flush();
      else void opened.vs.pollNow();
    };
    const onPageHide = () => void opened.vs.suspend();
    const onFocus = () => void opened.vs.pollNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('focus', onFocus);
    };
  });

  onDestroy(() => store.dispose());
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app">
  <header class="app-header">
    <span class="brand"><Msg key="shell.appName" /></span>
    <span class="spacer"></span>
    {#if scopeTitle}
      <span class="muted small" data-testid="undo-scope">{msgText('shell.undoScope', { module: msgText(scopeTitle) })}</span>
    {/if}
    <button type="button" data-testid="undo" disabled={!canUndo} onclick={undo}><Msg key="shell.undo" /></button>
    <button type="button" data-testid="redo" disabled={!canRedo} onclick={redo}><Msg key="shell.redo" /></button>
  </header>
  <main class="app-main">
    <LayoutHost node={DEFAULT_LAYOUT} />
  </main>
  <StatusBar vaultName={opened.name} {onclose} />
  <div class="toasts" aria-live="polite">
    {#each toasts as t (t.id)}
      <div class="toast" role="status">{t.text}</div>
    {/each}
  </div>
</div>
