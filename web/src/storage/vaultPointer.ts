/**
 * The single piece of state kept outside the vault: the vault folder's directory handle.
 * Handles can only be persisted in IndexedDB (not cookies or localStorage).
 */
const DB_NAME = 'focuspocus';
const STORE = 'pointer';
const KEY = 'vault';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** How long to wait for the browser's IndexedDB before giving up on the remembered folder. */
const LOAD_TIMEOUT_MS = 3_000;

/** Null when nothing is stored, IndexedDB fails, or it doesn't answer in time (seen after a Chrome update). */
export async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[FocusPocus] IndexedDB did not answer within ${LOAD_TIMEOUT_MS} ms; skipping the remembered vault`);
      resolve(null);
    }, LOAD_TIMEOUT_MS);
  });
  const load = run('readonly', (s) => s.get(KEY)).then(
    (v) => (v as FileSystemDirectoryHandle | undefined) ?? null,
    () => null,
  );
  try {
    return await Promise.race([load, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await run('readwrite', (s) => s.put(handle, KEY));
}
