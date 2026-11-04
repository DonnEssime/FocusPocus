import type { MessageParams } from '@focuspocus/core/i18n/types';
import { createBroadcastChannelPort } from '@focuspocus/core/vault/broadcast';
import { createVault, inspectVaultFolder } from '@focuspocus/core/vault/vault';
import { VaultSession } from '@focuspocus/core/vault/vault-session';
import { MODULES, type AppMessageKey } from '@focuspocus/registry';
import { FsAccessBackend } from '../storage/fsAccessBackend';
import { saveVaultHandle } from '../storage/vaultPointer';

export interface OpenedVault {
  vs: VaultSession;
  name: string;
}

export type OpenResult = { ok: true; opened: OpenedVault } | { ok: false; error: AppMessageKey; params?: MessageParams };

export function isFsAccessSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

export async function hasPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** Must be called from a user gesture (click). */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Returns null when the user cancels the picker. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker!({ id: 'focuspocus-vault', mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

function webLock(name: string, fn: () => Promise<void>): Promise<void> {
  if (!navigator.locks) return fn();
  return navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
    if (lock) await fn();
  });
}

export async function openVault(handle: FileSystemDirectoryHandle, options: { remember: boolean }): Promise<OpenResult> {
  try {
    const backend = new FsAccessBackend(handle);
    const kind = await inspectVaultFolder(backend);
    if (kind === 'other') return { ok: false, error: 'shell.picker.notAVault' };
    if (kind === 'empty') await createVault(backend);
    const vs = await VaultSession.open(backend, {
      modules: MODULES,
      broadcast: createBroadcastChannelPort,
      withLock: webLock,
    });
    if (options.remember) await saveVaultHandle(handle);
    vs.start();
    return { ok: true, opened: { vs, name: handle.name } };
  } catch (e) {
    return { ok: false, error: 'shell.picker.openFailed', params: { error: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Dev/E2E only: `?opfs=<name>` opens a vault in the browser's private file system, so the app
 * can be driven without a native folder picker. Never available in production builds.
 */
export async function devOpfsHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!import.meta.env.DEV) return null;
  const name = new URLSearchParams(location.search).get('opfs');
  if (name === null) return null;
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(`dev-vault-${name || 'default'}`, { create: true });
}
