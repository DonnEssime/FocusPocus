/**
 * Minimal file-system abstraction for a vault folder. Paths are `/`-separated and relative to
 * the vault root. Implementations: File System Access API (web), in-memory (tests).
 */
export interface FileInfo {
  name: string;
  kind: 'file' | 'dir';
  size: number;
  lastModified: number;
}

export interface StorageBackend {
  /** Direct children of `dir` (`''` = root). A missing directory lists as empty. */
  list(dir: string): Promise<FileInfo[]>;
  read(path: string): Promise<Uint8Array>;
  /** Create or fully replace a file (parent directories are created). */
  write(path: string, data: Uint8Array | string): Promise<void>;
  /** Append to a file, creating it (and parents) if needed. */
  append(path: string, text: string): Promise<void>;
  /** Remove a file; removing a missing file is not an error. */
  remove(path: string): Promise<void>;
  stat(path: string): Promise<FileInfo | null>;
}

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}
