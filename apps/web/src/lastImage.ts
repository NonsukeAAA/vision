/**
 * Remembers the picked image so a reload — or a tab that iOS killed — does not
 * force the user to pick the same file again.
 *
 * IndexedDB rather than sessionStorage: it stores a Blob directly and survives the
 * reload prompt mobile Safari shows after dropping a tab.
 */

import { describeError, logInfo, logWarn } from "./diagnostics";

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

export async function saveLastImage(file: File): Promise<void> {
  try {
    const record: StoredImage = {
      blob: file.slice(0, file.size, file.type),
      name: file.name,
      type: file.type || "image/jpeg",
      savedAt: Date.now(),
    };
    await withStore("readwrite", (store) => store.put(record, KEY));
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
      (store) => store.get(KEY),
    );
    if (!record?.blob) return null;
    return new File([record.blob], record.name || "image.jpg", {
      type: record.type || record.blob.type || "image/jpeg",
    });
  } catch (err) {
    logWarn("last image restore failed", describeError(err));
    return null;
  }
}

export async function clearLastImage(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(KEY));
  } catch (err) {
    logWarn("last image clear failed", describeError(err));
  }
}
