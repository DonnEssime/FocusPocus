import { isCommandShape, type Command } from '../command/types';
import { SEGMENT_CLOSED, SEGMENT_HEADER, type SegmentHeader } from './format';

export interface ParsedSegment {
  header: SegmentHeader | null;
  closed: boolean;
  commands: Command[];
  /** Lines that were not valid JSON or not a command (e.g. a torn last line). Skipped. */
  invalidLines: number;
}

export function encodeLine(value: unknown): string {
  return JSON.stringify(value);
}

export function parseSegmentText(text: string): ParsedSegment {
  const out: ParsedSegment = { header: null, closed: false, commands: [], invalidLines: 0 };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      out.invalidLines++;
      continue;
    }
    const t = (value as { t?: unknown } | null)?.t;
    if (t === SEGMENT_HEADER) {
      out.header ??= value as SegmentHeader;
    } else if (t === SEGMENT_CLOSED) {
      out.closed = true;
    } else if (isCommandShape(value)) {
      out.commands.push(value);
    } else {
      out.invalidLines++;
    }
  }
  return out;
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function decodeLogBytes(bytes: Uint8Array): Promise<string> {
  return isGzip(bytes) ? gunzip(bytes) : new TextDecoder().decode(bytes);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
