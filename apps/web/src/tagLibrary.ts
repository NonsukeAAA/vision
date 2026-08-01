/**
 * On-device tag library: history (≤100), favorites, editable dictionary,
 * and the last working session. IndexedDB is the durable store for GitHub Pages
 * (no user-data server). Export/import covers backup and move between devices.
 */

import { describeError, logInfo, logWarn } from "./diagnostics";
import { normalizeTag } from "./forceUncensored";
import type { OutputMode, TagScore } from "./types";

const DB_NAME = "vision-tag-library";
const DB_VERSION = 1;
const HISTORY_LIMIT = 100;

const STORE_HISTORY = "history";
const STORE_FAVORITES = "favorites";
const STORE_DICT = "dictionary";
const STORE_META = "meta";
const META_SESSION = "lastSession";

export type TagSetRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  prompt: string;
  caption: string | null;
  mode: OutputMode;
  tags: TagScore[];
  votes: Record<string, number>;
  sourceNote: string;
  imageName: string;
  label: string;
};

export type DictEntry = {
  tag: string;
  category: string;
  lastScore: number;
  count: number;
  /** User override for Japanese gloss (empty = use built-in dict). */
  customJa: string;
  note: string;
  updatedAt: number;
};

export type TagLibraryExport = {
  version: 1;
  exportedAt: number;
  history: TagSetRecord[];
  favorites: TagSetRecord[];
  dictionary: DictEntry[];
  lastSession: TagSetRecord | null;
};

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        const hist = db.createObjectStore(STORE_HISTORY, { keyPath: "id" });
        hist.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        db.createObjectStore(STORE_FAVORITES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_DICT)) {
        db.createObjectStore(STORE_DICT, { keyPath: "tag" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function withDb<T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await withTimeout(openDb(), 5000, "tag library open");
  try {
    return await withTimeout(run(db), 12000, "tag library tx");
  } finally {
    db.close();
  }
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction error"));
  });
}

export function newTagSetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildTagSet(input: {
  tags: TagScore[];
  prompt: string;
  caption?: string | null;
  mode: OutputMode;
  votes?: Record<string, number>;
  sourceNote?: string;
  imageName?: string;
  label?: string;
  id?: string;
  createdAt?: number;
}): TagSetRecord {
  const now = Date.now();
  const preview = input.tags
    .slice(0, 6)
    .map((t) => t.tag)
    .join(", ");
  return {
    id: input.id ?? newTagSetId(),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    prompt: input.prompt,
    caption: input.caption ?? null,
    mode: input.mode,
    tags: input.tags.map((t) => ({ ...t })),
    votes: { ...(input.votes ?? {}) },
    sourceNote: input.sourceNote ?? "",
    imageName: input.imageName ?? "",
    label: input.label?.trim() || preview || "タグセット",
  };
}

async function trimHistory(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_HISTORY, "readwrite");
  const store = tx.objectStore(STORE_HISTORY);
  const index = store.index("createdAt");
  const all = (await reqToPromise(index.getAll())) as TagSetRecord[];
  if (all.length <= HISTORY_LIMIT) {
    await txDone(tx);
    return;
  }
  all.sort((a, b) => a.createdAt - b.createdAt);
  const drop = all.length - HISTORY_LIMIT;
  for (let i = 0; i < drop; i++) {
    store.delete(all[i].id);
  }
  await txDone(tx);
}

async function upsertDictionaryTags(
  db: IDBDatabase,
  tags: TagScore[],
): Promise<void> {
  if (tags.length === 0) return;
  const tx = db.transaction(STORE_DICT, "readwrite");
  const store = tx.objectStore(STORE_DICT);
  const now = Date.now();
  for (const t of tags) {
    const key = normalizeTag(t.tag);
    if (!key) continue;
    const prev = (await reqToPromise(store.get(key))) as DictEntry | undefined;
    const next: DictEntry = prev
      ? {
          ...prev,
          category: t.category || prev.category,
          lastScore: t.score,
          count: prev.count + 1,
          updatedAt: now,
        }
      : {
          tag: key,
          category: t.category || "general",
          lastScore: t.score,
          count: 1,
          customJa: "",
          note: "",
          updatedAt: now,
        };
    store.put(next);
  }
  await txDone(tx);
}

export async function saveGeneratedSet(record: TagSetRecord): Promise<void> {
  try {
    await withDb(async (db) => {
      const tx = db.transaction(
        [STORE_HISTORY, STORE_META],
        "readwrite",
      );
      tx.objectStore(STORE_HISTORY).put(record);
      tx.objectStore(STORE_META).put(record, META_SESSION);
      await txDone(tx);
      await upsertDictionaryTags(db, record.tags);
      await trimHistory(db);
    });
    logInfo("tag set saved", { id: record.id, tags: record.tags.length });
  } catch (err) {
    logWarn("tag set save failed", describeError(err));
  }
}

/** Persist the in-progress edit without creating a new history row. */
export async function saveLastSession(record: TagSetRecord): Promise<void> {
  try {
    await withDb(async (db) => {
      const tx = db.transaction(STORE_META, "readwrite");
      tx.objectStore(STORE_META).put(record, META_SESSION);
      await txDone(tx);
      await upsertDictionaryTags(db, record.tags);
    });
  } catch (err) {
    logWarn("last session save failed", describeError(err));
  }
}

export async function loadLastSession(): Promise<TagSetRecord | null> {
  try {
    return await withDb(async (db) => {
      const tx = db.transaction(STORE_META, "readonly");
      const row = (await reqToPromise(
        tx.objectStore(STORE_META).get(META_SESSION),
      )) as TagSetRecord | undefined;
      await txDone(tx);
      return row ?? null;
    });
  } catch (err) {
    logWarn("last session load failed", describeError(err));
    return null;
  }
}

export async function listHistory(): Promise<TagSetRecord[]> {
  try {
    return await withDb(async (db) => {
      const tx = db.transaction(STORE_HISTORY, "readonly");
      const rows = (await reqToPromise(
        tx.objectStore(STORE_HISTORY).index("createdAt").getAll(),
      )) as TagSetRecord[];
      await txDone(tx);
      return rows.sort((a, b) => b.createdAt - a.createdAt);
    });
  } catch (err) {
    logWarn("history list failed", describeError(err));
    return [];
  }
}

export async function listFavorites(): Promise<TagSetRecord[]> {
  try {
    return await withDb(async (db) => {
      const tx = db.transaction(STORE_FAVORITES, "readonly");
      const rows = (await reqToPromise(
        tx.objectStore(STORE_FAVORITES).getAll(),
      )) as TagSetRecord[];
      await txDone(tx);
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  } catch (err) {
    logWarn("favorites list failed", describeError(err));
    return [];
  }
}

export async function isFavorite(id: string): Promise<boolean> {
  try {
    return await withDb(async (db) => {
      const tx = db.transaction(STORE_FAVORITES, "readonly");
      const row = await reqToPromise(tx.objectStore(STORE_FAVORITES).get(id));
      await txDone(tx);
      return !!row;
    });
  } catch {
    return false;
  }
}

export async function addFavorite(record: TagSetRecord): Promise<void> {
  try {
    await withDb(async (db) => {
      const next = { ...record, updatedAt: Date.now() };
      const tx = db.transaction(STORE_FAVORITES, "readwrite");
      tx.objectStore(STORE_FAVORITES).put(next);
      await txDone(tx);
    });
  } catch (err) {
    logWarn("favorite add failed", describeError(err));
    throw err;
  }
}

export async function removeFavorite(id: string): Promise<void> {
  try {
    await withDb(async (db) => {
      const tx = db.transaction(STORE_FAVORITES, "readwrite");
      tx.objectStore(STORE_FAVORITES).delete(id);
      await txDone(tx);
    });
  } catch (err) {
    logWarn("favorite remove failed", describeError(err));
    throw err;
  }
}

export async function deleteHistory(id: string): Promise<void> {
  try {
    await withDb(async (db) => {
      const tx = db.transaction(STORE_HISTORY, "readwrite");
      tx.objectStore(STORE_HISTORY).delete(id);
      await txDone(tx);
    });
  } catch (err) {
    logWarn("history delete failed", describeError(err));
  }
}

export async function listDictionary(): Promise<DictEntry[]> {
  try {
    return await withDb(async (db) => {
      const tx = db.transaction(STORE_DICT, "readonly");
      const rows = (await reqToPromise(
        tx.objectStore(STORE_DICT).getAll(),
      )) as DictEntry[];
      await txDone(tx);
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  } catch (err) {
    logWarn("dictionary list failed", describeError(err));
    return [];
  }
}

export async function getDictEntry(tag: string): Promise<DictEntry | null> {
  const key = normalizeTag(tag);
  if (!key) return null;
  try {
    return await withDb(async (db) => {
      const tx = db.transaction(STORE_DICT, "readonly");
      const row = (await reqToPromise(
        tx.objectStore(STORE_DICT).get(key),
      )) as DictEntry | undefined;
      await txDone(tx);
      return row ?? null;
    });
  } catch {
    return null;
  }
}

export async function upsertDictEntry(
  patch: Partial<DictEntry> & { tag: string },
): Promise<DictEntry> {
  const key = normalizeTag(patch.tag);
  if (!key) throw new Error("empty tag");
  return withDb(async (db) => {
    const tx = db.transaction(STORE_DICT, "readwrite");
    const store = tx.objectStore(STORE_DICT);
    const prev = (await reqToPromise(store.get(key))) as DictEntry | undefined;
    const next: DictEntry = {
      tag: key,
      category: patch.category ?? prev?.category ?? "general",
      lastScore: patch.lastScore ?? prev?.lastScore ?? 0,
      count: patch.count ?? prev?.count ?? 0,
      customJa: patch.customJa ?? prev?.customJa ?? "",
      note: patch.note ?? prev?.note ?? "",
      updatedAt: Date.now(),
    };
    store.put(next);
    await txDone(tx);
    return next;
  });
}

export async function deleteDictEntry(tag: string): Promise<void> {
  const key = normalizeTag(tag);
  if (!key) return;
  await withDb(async (db) => {
    const tx = db.transaction(STORE_DICT, "readwrite");
    tx.objectStore(STORE_DICT).delete(key);
    await txDone(tx);
  });
}

/** Map of normalized tag → customJa for fast chip rendering. */
export async function loadCustomJaMap(): Promise<Record<string, string>> {
  const rows = await listDictionary();
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.customJa.trim()) map[row.tag] = row.customJa.trim();
  }
  return map;
}

export async function exportLibrary(): Promise<TagLibraryExport> {
  const [history, favorites, dictionary, lastSession] = await Promise.all([
    listHistory(),
    listFavorites(),
    listDictionary(),
    loadLastSession(),
  ]);
  return {
    version: 1,
    exportedAt: Date.now(),
    history,
    favorites,
    dictionary,
    lastSession,
  };
}

export async function importLibrary(
  data: TagLibraryExport,
  mode: "merge" | "replace" = "merge",
): Promise<void> {
  if (!data || data.version !== 1) throw new Error("対応していないバックアップです");
  await withDb(async (db) => {
    if (mode === "replace") {
      for (const name of [
        STORE_HISTORY,
        STORE_FAVORITES,
        STORE_DICT,
        STORE_META,
      ] as const) {
        const tx = db.transaction(name, "readwrite");
        tx.objectStore(name).clear();
        await txDone(tx);
      }
    }
    const tx = db.transaction(
      [STORE_HISTORY, STORE_FAVORITES, STORE_DICT, STORE_META],
      "readwrite",
    );
    const hist = tx.objectStore(STORE_HISTORY);
    const fav = tx.objectStore(STORE_FAVORITES);
    const dict = tx.objectStore(STORE_DICT);
    const meta = tx.objectStore(STORE_META);
    for (const row of data.history ?? []) hist.put(row);
    for (const row of data.favorites ?? []) fav.put(row);
    for (const row of data.dictionary ?? []) dict.put(row);
    if (data.lastSession) meta.put(data.lastSession, META_SESSION);
    await txDone(tx);
    await trimHistory(db);
  });
}
