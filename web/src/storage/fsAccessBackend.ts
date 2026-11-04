import { splitPath, type FileInfo, type StorageBackend } from '@focuspocus/core/storage/backend';

function isMissing(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
}

/** StorageBackend over a File System Access directory handle (a real folder on disk, or OPFS in dev). */
export class FsAccessBackend implements StorageBackend {
  constructor(readonly root: FileSystemDirectoryHandle) {}

  async list(dir: string): Promise<FileInfo[]> {
    const handle = await this.dir(dir, false);
    if (!handle) return [];
    const out: FileInfo[] = [];
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'file') {
        const file = await (entry as FileSystemFileHandle).getFile();
        out.push({ name, kind: 'file', size: file.size, lastModified: file.lastModified });
      } else {
        out.push({ name, kind: 'dir', size: 0, lastModified: 0 });
      }
    }
    return out;
  }

  async read(path: string): Promise<Uint8Array> {
    const handle = await this.file(path, false);
    if (!handle) throw new Error(`File not found: ${path}`);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const handle = (await this.file(path, true))!;
    const writable = await handle.createWritable();
    try {
      await writable.write(data as FileSystemWriteChunkType);
      await writable.close();
    } catch (e) {
      await writable.abort().catch(() => undefined);
      throw e;
    }
  }

  async append(path: string, text: string): Promise<void> {
    const handle = (await this.file(path, true))!;
    const size = (await handle.getFile()).size;
    // keepExistingData copies the file to a swap file; close() atomically replaces the original.
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
      await writable.seek(size);
      await writable.write(text);
      await writable.close();
    } catch (e) {
      await writable.abort().catch(() => undefined);
      throw e;
    }
  }

  async remove(path: string): Promise<void> {
    const { dir, name } = splitPath(path);
    const handle = await this.dir(dir, false);
    if (!handle) return;
    try {
      await handle.removeEntry(name);
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
  }

  async stat(path: string): Promise<FileInfo | null> {
    const handle = await this.file(path, false);
    if (!handle) return null;
    const file = await handle.getFile();
    return { name: file.name, kind: 'file', size: file.size, lastModified: file.lastModified };
  }

  private async dir(path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let handle = this.root;
    for (const part of path.split('/').filter(Boolean)) {
      try {
        handle = await handle.getDirectoryHandle(part, { create });
      } catch (e) {
        if (!create && isMissing(e)) return null;
        throw e;
      }
    }
    return handle;
  }

  private async file(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const { dir, name } = splitPath(path);
    const parent = await this.dir(dir, create);
    if (!parent) return null;
    try {
      return await parent.getFileHandle(name, { create });
    } catch (e) {
      if (!create && isMissing(e)) return null;
      throw e;
    }
  }
}
