/**
 * Supabase Storage sync for the tag library.
 * Uses a private bucket document (library.json). Works with sb_secret_… keys
 * without SQL migrations or Anonymous Sign-Ins.
 */

import { describeError, logInfo, logWarn } from "./diagnostics";
import {
  ensureLibraryBucket,
  getSupabase,
  LIBRARY_BUCKET,
  LIBRARY_OBJECT,
} from "./supabaseClient";
import type { DictEntry, TagLibraryExport, TagSetRecord } from "./tagLibrary";
import type { TagScore } from "./types";

let apiKeyProvider: () => string = () => "";

/** App wires this so sync reads the latest settings key. */
export function setSupabaseAnonKeyProvider(fn: () => string): void {
  apiKeyProvider = fn;
}

export function setSupabaseApiKeyProvider(fn: () => string): void {
  apiKeyProvider = fn;
}

function key(): string {
  return apiKeyProvider();
}

export type RemoteLibrary = {
  history: TagSetRecord[];
  favorites: TagSetRecord[];
  dictionary: DictEntry[];
  lastSession: TagSetRecord | null;
};

function emptyRemote(): RemoteLibrary {
  return {
    history: [],
    favorites: [],
    dictionary: [],
    lastSession: null,
  };
}

function normalizeExport(data: unknown): RemoteLibrary | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<TagLibraryExport>;
  if (d.version !== 1) return null;
  return {
    history: Array.isArray(d.history) ? d.history : [],
    favorites: Array.isArray(d.favorites) ? d.favorites : [],
    dictionary: Array.isArray(d.dictionary) ? d.dictionary : [],
    lastSession: d.lastSession ?? null,
  };
}

async function downloadRemote(): Promise<RemoteLibrary | null> {
  const sb = getSupabase(key());
  if (!sb) return null;
  await ensureLibraryBucket(key());
  const { data, error } = await sb.storage
    .from(LIBRARY_BUCKET)
    .download(LIBRARY_OBJECT);
  if (error) {
    if (/not found|404|Object not found/i.test(error.message)) {
      return emptyRemote();
    }
    throw error;
  }
  const text = await data.text();
  if (!text.trim()) return emptyRemote();
  return normalizeExport(JSON.parse(text));
}

async function uploadRemote(payload: TagLibraryExport): Promise<void> {
  const sb = getSupabase(key());
  if (!sb) return;
  await ensureLibraryBucket(key());
  const body = JSON.stringify(payload);
  const { error } = await sb.storage
    .from(LIBRARY_BUCKET)
    .upload(LIBRARY_OBJECT, body, {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw error;
}

function mergeSets(
  local: TagSetRecord[],
  remote: TagSetRecord[],
): TagSetRecord[] {
  const map = new Map<string, TagSetRecord>();
  for (const row of remote) map.set(row.id, row);
  for (const row of local) {
    const prev = map.get(row.id);
    if (!prev || (prev.updatedAt || 0) <= (row.updatedAt || 0)) {
      map.set(row.id, row);
    }
  }
  return [...map.values()];
}

function mergeDict(local: DictEntry[], remote: DictEntry[]): DictEntry[] {
  const map = new Map<string, DictEntry>();
  for (const row of remote) map.set(row.tag, row);
  for (const row of local) {
    const prev = map.get(row.tag);
    if (!prev || (prev.updatedAt || 0) <= (row.updatedAt || 0)) {
      map.set(row.tag, row);
    }
  }
  return [...map.values()];
}

function mergeSession(
  local: TagSetRecord | null,
  remote: TagSetRecord | null,
): TagSetRecord | null {
  if (!local) return remote;
  if (!remote) return local;
  return (local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote;
}

export async function pullRemoteLibrary(): Promise<RemoteLibrary | null> {
  if (!key()) return null;
  try {
    const remote = await downloadRemote();
    if (!remote) return null;
    logInfo("supabase storage pull", {
      history: remote.history.length,
      favorites: remote.favorites.length,
      dict: remote.dictionary.length,
    });
    return remote;
  } catch (err) {
    logWarn("supabase storage pull failed", describeError(err));
    throw err;
  }
}

export async function pushFullLibrary(data: {
  history: TagSetRecord[];
  favorites: TagSetRecord[];
  dictionary: DictEntry[];
  lastSession: TagSetRecord | null;
}): Promise<void> {
  if (!key()) return;
  // Merge with remote so another device's newer rows are not wiped.
  let remote = emptyRemote();
  try {
    remote = (await downloadRemote()) ?? emptyRemote();
  } catch {
    remote = emptyRemote();
  }
  const history = mergeSets(data.history, remote.history)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
  const favorites = mergeSets(data.favorites, remote.favorites).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const dictionary = mergeDict(data.dictionary, remote.dictionary);
  const lastSession = mergeSession(data.lastSession, remote.lastSession);
  const payload: TagLibraryExport = {
    version: 1,
    exportedAt: Date.now(),
    history,
    favorites,
    dictionary,
    lastSession,
  };
  await uploadRemote(payload);
  logInfo("supabase storage push", {
    history: history.length,
    favorites: favorites.length,
    dict: dictionary.length,
  });
}

/** Push after a small local mutation (re-reads full local via caller). */
export async function remoteUpsertSet(
  _record: TagSetRecord,
  _kind: "history" | "favorite" | "session",
): Promise<void> {
  // Full-document sync is performed by syncLibraryToRemote from tagLibrary.
}

export async function remoteDeleteSet(
  _id: string,
  _kind?: "history" | "favorite" | "session",
): Promise<void> {
  // Handled by subsequent full push from tagLibrary wrappers.
}

export async function remoteUpsertDict(_entry: DictEntry): Promise<void> {
  // Handled by subsequent full push.
}

export async function remoteDeleteDict(_tag: string): Promise<void> {
  // Handled by subsequent full push.
}

export async function remoteUpsertDictTags(_tags: TagScore[]): Promise<void> {
  // Handled by subsequent full push.
}

export async function safeSync(
  label: string,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (err) {
    logWarn(`supabase ${label} failed`, describeError(err));
  }
}
