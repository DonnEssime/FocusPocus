/**
 * Versions that end up on disk. See README §5.
 *
 * - APP_VERSION: release version (semver), mirrors package.json. Informational only.
 * - VAULT_FORMAT_VERSION: the container format (layout, encoding, headers, ordering rules).
 *   Bump only for breaking container changes, together with a frozen fixture and a migration.
 */
export const APP_VERSION = '0.1.0';
export const VAULT_FORMAT_VERSION = 1;

export const MANIFEST_FILE = 'vault.json';
export const MANIFEST_KIND = 'focuspocus-vault';

export interface VaultManifest {
  kind: typeof MANIFEST_KIND;
  format: number;
  vaultId: string;
  createdAt: number;
  app: string;
}

export const SEGMENT_HEADER = 'core.SegmentHeader';
export const SEGMENT_CLOSED = 'core.SegmentClosed';

export interface SegmentHeader {
  t: typeof SEGMENT_HEADER;
  format: number;
  app: string;
  /** Writer id that produced the segment. */
  w: string;
  /** Present on compacted month files. */
  month?: string;
}

export function isManifest(value: unknown): value is VaultManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.kind === MANIFEST_KIND && typeof m.format === 'number' && typeof m.vaultId === 'string';
}
