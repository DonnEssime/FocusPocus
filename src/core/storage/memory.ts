import { splitPath, type FileInfo, type StorageBackend } from './backend';

interface MemFile {
  data: Uint8Array;
  lastModified: number;
}

const encoder = new TextEncoder();

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data.slice();
}

/** In-memory backend for tests. Counts write operations so tests can assert on write volume. */
export class MemoryBackend implements StorageBackend {
  readonly files = new Map<string, MemFile>();
  writes = 0;
  failNextWrites = 0;

  constructor(public now: () => number = () => Date.now()) {}

  async list(dir: string): Promise<FileInfo[]> {
    const prefix = dir ? `${dir}/` : '';
    const out = new Map<string, FileInfo>();
    for (const [path, file] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) {
        out.set(rest, { name: rest, kind: 'file', size: file.data.length, lastModified: file.lastModified });
      } else {
        const name = rest.slice(0, slash);
        if (!out.has(name)) out.set(name, { name, kind: 'dir', size: 0, lastModified: 0 });
      }
    }
    return [...out.values()];
  }

  async read(path: string): Promise<Uint8Array> {
    const f = this.files.get(path);
    if (!f) throw new Error(`File not found: ${path}`);
    return f.data.slice();
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.beforeWrite(path);
    this.files.set(path, { data: toBytes(data), lastModified: this.now() });
  }

  async append(path: string, text: string): Promise<void> {
    this.beforeWrite(path);
    const prev = this.files.get(path)?.data ?? new Uint8Array();
    const add = encoder.encode(text);
    const next = new Uint8Array(prev.length + add.length);
    next.set(prev);
    next.set(add, prev.length);
    this.files.set(path, { data: next, lastModified: this.now() });
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async stat(path: string): Promise<FileInfo | null> {
    const f = this.files.get(path);
    if (!f) return null;
    return { name: splitPath(path).name, kind: 'file', size: f.data.length, lastModified: f.lastModified };
  }

  text(path: string): string {
    const f = this.files.get(path);
    return f ? new TextDecoder().decode(f.data) : '';
  }

  paths(dir = ''): string[] {
    const prefix = dir ? `${dir}/` : '';
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  }

  private beforeWrite(path: string): void {
    if (this.failNextWrites > 0) {
      this.failNextWrites--;
      throw new Error(`Simulated write failure: ${path}`);
    }
    this.writes++;
  }
}
