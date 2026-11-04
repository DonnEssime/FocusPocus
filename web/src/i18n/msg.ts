import { resolveMessage, type ResolvedMessage } from '@focuspocus/core/i18n/resolve';
import type { MessageParams } from '@focuspocus/core/i18n/types';
import { catalog, type AppMessageKey } from '@focuspocus/registry';
import { getLocale } from './locale.svelte';

/** Typed keys for UI code; plain strings are accepted for failure reasons coming from commands. */
export type MsgKey = AppMessageKey | (string & {});

export function msg(key: MsgKey, params?: MessageParams): ResolvedMessage {
  return resolveMessage(catalog, key, getLocale(), params);
}

export function msgText(key: MsgKey, params?: MessageParams): string {
  return msg(key, params).text;
}
