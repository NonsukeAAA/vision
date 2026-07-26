/**
 * Remembers the picked image so a reload — or a tab the OS killed mid-analysis —
 * does not force the user to pick the same file again.
 *
 * IndexedDB rather than sessionStorage: it takes a Blob directly and survives the
 * "この Web ページを再読み込み" tap after mobile Safari drops the tab.
 */

const DB_NAME = "vision-last-image";
const STORE = "image";
const KEY = "current";
const DB_VERSION = 1;

type StoredImage = {
  blob: Blob;
  name: string;
  type: string;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

export async function saveLastImage(file: File): Promise<void> {
  try {
    const record: StoredImage = {
      blob: file.slice(0, file.size, file.type),
      name: file.name,
      type: file.type || "image/jpeg",
      savedAt: Date.now(),
    };
    await withStore("readwrite", (store) => store.put(record, KEY));
  } catch {
    // Private browsing and storage pressure both land here; the app works without it.
  }
}

export async function loadLastImage(): Promise<File | null> {
  try {
    const record = await withStore<StoredImage | undefined>("readonly", (store) =>
      store.get(KEY),
    );
    if (!record?.blob) return null;
    return new File([record.blob], record.name || "image.jpg", {
      type: record.type || record.blob.type || "image/jpeg",
    });
  } catch {
    return null;
  }
}

export async function clearLastImage(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(KEY));
  } catch {
    // ignore
  }
}
