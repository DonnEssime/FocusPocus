import type { Command } from './types';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
export const WRITER_ID_LENGTH = 8;

/** Random short id for one writer (one open window). Never persisted outside the vault. */
export function newWriterId(length = WRITER_ID_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Random id for entities (vault id etc.). */
export function newRandomId(length = 12): string {
  return newWriterId(length);
}

export function makeCommandId(writer: string, seq: number): string {
  return `${writer}.${seq.toString(36)}`;
}

export interface CommandKey {
  at: number;
  writer: string;
  seq: number;
}

const ID_PATTERN = /^([0-9a-z]{1,32})\.([0-9a-z]{1,11})$/;

export function parseCommandId(id: string): { writer: string; seq: number } | null {
  const m = ID_PATTERN.exec(id);
  if (!m) return null;
  return { writer: m[1]!, seq: parseInt(m[2]!, 36) };
}

/** Global total order: (at, writer, seq). Identical on every computer for the same set of commands. */
export function compareKeys(a: CommandKey, b: CommandKey): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.writer !== b.writer) return a.writer < b.writer ? -1 : 1;
  return a.seq - b.seq;
}

export function commandKey(cmd: Command): CommandKey | null {
  const parsed = parseCommandId(cmd.id);
  return parsed ? { at: cmd.at, writer: parsed.writer, seq: parsed.seq } : null;
}

export function compareCommands(a: Command, b: Command): number {
  const ka = commandKey(a);
  const kb = commandKey(b);
  if (!ka || !kb) return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return compareKeys(ka, kb);
}
