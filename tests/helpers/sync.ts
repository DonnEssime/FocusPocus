import type { MemoryBackend } from '../../src/core/storage/memory';

/**
 * Simulates a file-sync client (Google Drive style) between two computers' folders:
 * - files created or changed on one side are copied to the other;
 * - files deleted on one side (that existed at the last sync) are deleted on the other;
 * - a file changed on both sides keeps the newer version and the older one becomes a
 *   conflict copy `name (1).ext` on both sides.
 */
export class SyncLink {
  private lastSynced = new Map<string, string>();

  constructor(
    private readonly a: MemoryBackend,
    private readonly b: MemoryBackend,
  ) {}

  sync(): void {
    const paths = new Set([...this.a.files.keys(), ...this.b.files.keys(), ...this.lastSynced.keys()]);
    const next = new Map<string, string>();
    for (const path of paths) {
      const fa = this.a.files.get(path);
      const fb = this.b.files.get(path);
      const base = this.lastSynced.get(path);
      const sa = fa ? fingerprint(fa.data) : undefined;
      const sb = fb ? fingerprint(fb.data) : undefined;
      if (sa === sb) {
        if (sa !== undefined) next.set(path, sa);
        continue;
      }
      const changedA = sa !== base;
      const changedB = sb !== base;
      if (changedA && !changedB) {
        this.copy(this.a, this.b, path);
      } else if (changedB && !changedA) {
        this.copy(this.b, this.a, path);
      } else if (fa && fb) {
        const [winner, loser] = fa.lastModified >= fb.lastModified ? [this.a, this.b] : [this.b, this.a];
        const conflict = conflictName(path);
        loser.files.set(conflict, { ...loser.files.get(path)! });
        winner.files.set(conflict, { ...loser.files.get(path)! });
        this.copy(winner, loser, path);
        next.set(conflict, fingerprint(winner.files.get(conflict)!.data));
      } else {
        // created on one side, deleted on the other: keep the file
        this.copy(fa ? this.a : this.b, fa ? this.b : this.a, path);
      }
      const final = this.a.files.get(path);
      if (final) next.set(path, fingerprint(final.data));
    }
    this.lastSynced = next;
  }

  private copy(from: MemoryBackend, to: MemoryBackend, path: string): void {
    const f = from.files.get(path);
    if (f) to.files.set(path, { data: f.data.slice(), lastModified: f.lastModified });
    else to.files.delete(path);
  }
}

function fingerprint(data: Uint8Array): string {
  let h = 2166136261;
  for (const b of data) h = Math.imul(h ^ b, 16777619);
  return `${data.length}:${h >>> 0}`;
}

function conflictName(path: string): string {
  const dot = path.indexOf('.', path.lastIndexOf('/') + 1);
  return dot < 0 ? `${path} (1)` : `${path.slice(0, dot)} (1)${path.slice(dot)}`;
}
