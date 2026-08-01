/**
 * Remembers picked images in IndexedDB so reload / iOS tab kill does not
 * force the user to re-pick. Also stores one blob per tag-set id so history
 * and favorites can restore the matching picture.
 */

import { describeError, logInfo, logWarn } from "./diagnostics";

const DB_NAME = "vision-last-image";
const STORE = "image";
const CURRENT_KEY = "current";
const DB_VERSION = 2;

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

/** After a killed tab, IndexedDB can stay blocked and never call back. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await withTimeout(openDb(), 5000, "IndexedDB open");
  try {
    return await withTimeout(
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(req.error ?? new Error("IndexedDB request failed"));
        tx.onabort = () =>
          reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      }),
      8000,
      `IndexedDB ${mode}`,
    );
  } finally {
    db.close();
  }
}

function toStored(file: File): StoredImage {
  return {
    blob: file.slice(0, file.size, file.type),
    name: file.name,
    type: file.type || "image/jpeg",
    savedAt: Date.now(),
  };
}

function toFile(record: StoredImage | undefined): File | null {
  if (!record?.blob) return null;
  return new File([record.blob], record.name || "image.jpg", {
    type: record.type || record.blob.type || "image/jpeg",
  });
}

export async function saveLastImage(file: File): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(toStored(file), CURRENT_KEY));
    logInfo("last image saved", { mb: Math.round((file.size / 1e6) * 10) / 10 });
  } catch (err) {
    // Private browsing and storage pressure land here; the app works without it.
    logWarn("last image save failed", describeError(err));
  }
}

export async function loadLastImage(): Promise<File | null> {
  try {
    const record = await withStore<StoredImage | undefined>(
      "readonly",
      (store) => store.get(CURRENT_KEY),
    );
    return toFile(record);
  } catch (err) {
    logWarn("last image restore failed", describeError(err));
    return null;
  }
}

export async function clearLastImage(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(CURRENT_KEY));
  } catch (err) {
    logWarn("last image clear failed", describeError(err));
  }
}

/** Persist the image for a history / favorite / session tag-set id. */
export async function saveSetImage(id: string, file: File): Promise<void> {
  if (!id) return;
  try {
    await withStore("readwrite", (store) => store.put(toStored(file), id));
    logInfo("set image saved", {
      id: id.slice(0, 8),
      mb: Math.round((file.size / 1e6) * 10) / 10,
    });
  } catch (err) {
    logWarn("set image save failed", describeError(err));
  }
}

export async function loadSetImage(id: string): Promise<File | null> {
  if (!id) return null;
  try {
    const record = await withStore<StoredImage | undefined>(
      "readonly",
      (store) => store.get(id),
    );
    return toFile(record);
  } catch (err) {
    logWarn("set image load failed", describeError(err));
    return null;
  }
}

export async function deleteSetImage(id: string): Promise<void> {
  if (!id || id === CURRENT_KEY) return;
  try {
    await withStore("readwrite", (store) => store.delete(id));
  } catch (err) {
    logWarn("set image delete failed", describeError(err));
  }
}

/** Drop set images whose ids are no longer referenced. Keeps "current". */
export async function pruneSetImages(keepIds: Iterable<string>): Promise<void> {
  const keep = new Set(keepIds);
  keep.add(CURRENT_KEY);
  try {
    const db = await withTimeout(openDb(), 5000, "IndexedDB open");
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          const req = store.getAllKeys();
          req.onsuccess = () => {
            const keys = (req.result ?? []) as IDBValidKey[];
            for (const key of keys) {
              if (typeof key === "string" && !keep.has(key)) {
                store.delete(key);
              }
            }
          };
          req.onerror = () =>
            reject(req.error ?? new Error("IndexedDB getAllKeys failed"));
          tx.oncomplete = () => resolve();
          tx.onabort = () =>
            reject(tx.error ?? new Error("IndexedDB prune aborted"));
        }),
        8000,
        "IndexedDB prune",
      );
    } finally {
      db.close();
    }
  } catch (err) {
    logWarn("set image prune failed", describeError(err));
  }
}
