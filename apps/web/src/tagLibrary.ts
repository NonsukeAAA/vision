/**
 * Tag library stored entirely in Supabase Postgres (vision_tag_sets /
 * vision_tag_dictionary). No IndexedDB sync — Supabase is the source of truth.
 * Requires the service_role (or sb_secret) API key in settings.
 */

import { describeError, logInfo, logWarn } from "./diagnostics";
import { normalizeTag } from "./forceUncensored";
import { getSupabase } from "./supabaseClient";
import type { OutputMode, TagScore } from "./types";

const HISTORY_LIMIT = 100;

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

type SetKind = "history" | "favorite" | "session";

type SetRow = {
  id: string;
  kind: SetKind;
  label: string;
  prompt: string;
  caption: string | null;
  mode: string;
  tags: TagScore[];
  votes: Record<string, number>;
  source_note: string;
  image_name: string;
  created_at: string;
  updated_at: string;
};

type DictRow = {
  tag: string;
  category: string;
  last_score: number;
  count: number;
  custom_ja: string;
  note: string;
  updated_at: string;
};

let apiKeyProvider: () => string = () => "";

export function setSupabaseAnonKeyProvider(fn: () => string): void {
  apiKeyProvider = fn;
}

function key(): string {
  return apiKeyProvider();
}

function requireClient() {
  const sb = getSupabase(key());
  if (!sb) {
    throw new Error(
      "Supabase API キー未設定。設定 → タグライブラリに service_role を貼ってください。",
    );
  }
  return sb;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function fromIso(value: string | null | undefined, fallback = Date.now()): number {
  if (!value) return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : fallback;
}

function rowToRecord(row: SetRow): TagSetRecord {
  return {
    id: row.id,
    createdAt: fromIso(row.created_at),
    updatedAt: fromIso(row.updated_at),
    prompt: row.prompt ?? "",
    caption: row.caption ?? null,
    mode: (row.mode as OutputMode) || "booru",
    tags: Array.isArray(row.tags) ? row.tags : [],
    votes: row.votes && typeof row.votes === "object" ? row.votes : {},
    sourceNote: row.source_note ?? "",
    imageName: row.image_name ?? "",
    label: row.label ?? "",
  };
}

function recordToRow(record: TagSetRecord, kind: SetKind): SetRow {
  return {
    id: record.id,
    kind,
    label: record.label,
    prompt: record.prompt,
    caption: record.caption,
    mode: record.mode,
    tags: record.tags,
    votes: record.votes,
    source_note: record.sourceNote,
    image_name: record.imageName,
    created_at: toIso(record.createdAt),
    updated_at: toIso(record.updatedAt || Date.now()),
  };
}

function dictToRow(entry: DictEntry): DictRow {
  return {
    tag: entry.tag,
    category: entry.category,
    last_score: entry.lastScore,
    count: entry.count,
    custom_ja: entry.customJa,
    note: entry.note,
    updated_at: toIso(entry.updatedAt),
  };
}

function rowToDict(row: DictRow): DictEntry {
  return {
    tag: row.tag,
    category: row.category,
    lastScore: row.last_score,
    count: row.count,
    customJa: row.custom_ja,
    note: row.note,
    updatedAt: fromIso(row.updated_at),
  };
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

/** True when vision_tag_sets is reachable with the current key. */
export async function isTagLibraryReady(): Promise<boolean> {
  try {
    const sb = requireClient();
    const { error } = await sb
      .from("vision_tag_sets")
      .select("id")
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function probeTagLibraryError(): Promise<string | null> {
  try {
    const sb = getSupabase(key());
    if (!sb) return "API キー未設定";
    const { error } = await sb.from("vision_tag_sets").select("id").limit(1);
    if (!error) return null;
    if (error.code === "PGRST205" || /Could not find the table/i.test(error.message)) {
      return "テーブル未作成。下の SQL を Dashboard の SQL Editor で実行してください。";
    }
    return error.message;
  } catch (err) {
    return String(describeError(err).message || err);
  }
}

async function upsertSet(record: TagSetRecord, kind: SetKind): Promise<void> {
  const sb = requireClient();
  if (kind === "session") {
    await sb.from("vision_tag_sets").delete().eq("kind", "session");
  }
  const { error } = await sb
    .from("vision_tag_sets")
    .upsert(recordToRow(record, kind), { onConflict: "id,kind" });
  if (error) throw error;
}

async function trimHistory(): Promise<void> {
  const sb = requireClient();
  const { data, error } = await sb
    .from("vision_tag_sets")
    .select("id, created_at")
    .eq("kind", "history")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const extra = (data ?? []).slice(HISTORY_LIMIT);
  if (extra.length === 0) return;
  const { error: delErr } = await sb
    .from("vision_tag_sets")
    .delete()
    .eq("kind", "history")
    .in(
      "id",
      extra.map((r) => r.id),
    );
  if (delErr) throw delErr;
}

async function bumpDictionary(tags: TagScore[]): Promise<void> {
  if (tags.length === 0) return;
  const sb = requireClient();
  const keys = [
    ...new Set(
      tags
        .map((t) => normalizeTag(t.tag))
        .filter(Boolean),
    ),
  ];
  const { data: existing, error: readErr } = await sb
    .from("vision_tag_dictionary")
    .select("*")
    .in("tag", keys);
  if (readErr) throw readErr;
  const map = new Map<string, DictRow>();
  for (const row of (existing ?? []) as DictRow[]) map.set(row.tag, row);
  const now = Date.now();
  const rows: DictRow[] = [];
  for (const t of tags) {
    const tag = normalizeTag(t.tag);
    if (!tag) continue;
    const prev = map.get(tag);
    const next: DictRow = prev
      ? {
          ...prev,
          category: t.category || prev.category,
          last_score: t.score,
          count: (prev.count || 0) + 1,
          updated_at: toIso(now),
        }
      : {
          tag,
          category: t.category || "general",
          last_score: t.score,
          count: 1,
          custom_ja: "",
          note: "",
          updated_at: toIso(now),
        };
    map.set(tag, next);
    rows.push(next);
  }
  if (rows.length === 0) return;
  const { error } = await sb
    .from("vision_tag_dictionary")
    .upsert(rows, { onConflict: "tag" });
  if (error) throw error;
}

export async function saveGeneratedSet(record: TagSetRecord): Promise<void> {
  try {
    await upsertSet(record, "history");
    await upsertSet(record, "session");
    await bumpDictionary(record.tags);
    await trimHistory();
    logInfo("tag set saved (supabase)", {
      id: record.id,
      tags: record.tags.length,
    });
  } catch (err) {
    logWarn("tag set save failed", describeError(err));
    throw err;
  }
}

export async function saveLastSession(record: TagSetRecord): Promise<void> {
  try {
    await upsertSet(record, "session");
    await bumpDictionary(record.tags);
  } catch (err) {
    logWarn("last session save failed", describeError(err));
  }
}

export async function loadLastSession(): Promise<TagSetRecord | null> {
  try {
    const sb = requireClient();
    const { data, error } = await sb
      .from("vision_tag_sets")
      .select("*")
      .eq("kind", "session")
      .maybeSingle();
    if (error) throw error;
    return data ? rowToRecord(data as SetRow) : null;
  } catch (err) {
    logWarn("last session load failed", describeError(err));
    return null;
  }
}

export async function listHistory(): Promise<TagSetRecord[]> {
  try {
    const sb = requireClient();
    const { data, error } = await sb
      .from("vision_tag_sets")
      .select("*")
      .eq("kind", "history")
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;
    return ((data ?? []) as SetRow[]).map(rowToRecord);
  } catch (err) {
    logWarn("history list failed", describeError(err));
    return [];
  }
}

export async function listFavorites(): Promise<TagSetRecord[]> {
  try {
    const sb = requireClient();
    const { data, error } = await sb
      .from("vision_tag_sets")
      .select("*")
      .eq("kind", "favorite")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as SetRow[]).map(rowToRecord);
  } catch (err) {
    logWarn("favorites list failed", describeError(err));
    return [];
  }
}

export async function isFavorite(id: string): Promise<boolean> {
  try {
    const sb = requireClient();
    const { data, error } = await sb
      .from("vision_tag_sets")
      .select("id")
      .eq("kind", "favorite")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  } catch {
    return false;
  }
}

export async function addFavorite(record: TagSetRecord): Promise<void> {
  const next = { ...record, updatedAt: Date.now() };
  await upsertSet(next, "favorite");
}

export async function removeFavorite(id: string): Promise<void> {
  const sb = requireClient();
  const { error } = await sb
    .from("vision_tag_sets")
    .delete()
    .eq("kind", "favorite")
    .eq("id", id);
  if (error) throw error;
}

export async function deleteHistory(id: string): Promise<void> {
  try {
    const sb = requireClient();
    const { error } = await sb
      .from("vision_tag_sets")
      .delete()
      .eq("kind", "history")
      .eq("id", id);
    if (error) throw error;
  } catch (err) {
    logWarn("history delete failed", describeError(err));
  }
}

export async function listDictionary(): Promise<DictEntry[]> {
  try {
    const sb = requireClient();
    const { data, error } = await sb
      .from("vision_tag_dictionary")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return ((data ?? []) as DictRow[]).map(rowToDict);
  } catch (err) {
    logWarn("dictionary list failed", describeError(err));
    return [];
  }
}

export async function getDictEntry(tag: string): Promise<DictEntry | null> {
  const keyTag = normalizeTag(tag);
  if (!keyTag) return null;
  try {
    const sb = requireClient();
    const { data, error } = await sb
      .from("vision_tag_dictionary")
      .select("*")
      .eq("tag", keyTag)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToDict(data as DictRow) : null;
  } catch {
    return null;
  }
}

export async function upsertDictEntry(
  patch: Partial<DictEntry> & { tag: string },
): Promise<DictEntry> {
  const tag = normalizeTag(patch.tag);
  if (!tag) throw new Error("empty tag");
  const sb = requireClient();
  const prev = await getDictEntry(tag);
  const next: DictEntry = {
    tag,
    category: patch.category ?? prev?.category ?? "general",
    lastScore: patch.lastScore ?? prev?.lastScore ?? 0,
    count: patch.count ?? prev?.count ?? 0,
    customJa: patch.customJa ?? prev?.customJa ?? "",
    note: patch.note ?? prev?.note ?? "",
    updatedAt: Date.now(),
  };
  const { error } = await sb
    .from("vision_tag_dictionary")
    .upsert(dictToRow(next), { onConflict: "tag" });
  if (error) throw error;
  return next;
}

export async function deleteDictEntry(tag: string): Promise<void> {
  const keyTag = normalizeTag(tag);
  if (!keyTag) return;
  const sb = requireClient();
  const { error } = await sb
    .from("vision_tag_dictionary")
    .delete()
    .eq("tag", keyTag);
  if (error) throw error;
}

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
  const sb = requireClient();
  if (mode === "replace") {
    const { error: e1 } = await sb
      .from("vision_tag_sets")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (e1) throw e1;
    const { error: e2 } = await sb
      .from("vision_tag_dictionary")
      .delete()
      .neq("tag", "");
    if (e2) throw e2;
  }
  const setRows: SetRow[] = [
    ...(data.history ?? []).map((r) => recordToRow(r, "history")),
    ...(data.favorites ?? []).map((r) => recordToRow(r, "favorite")),
  ];
  if (data.lastSession) {
    await sb.from("vision_tag_sets").delete().eq("kind", "session");
    setRows.push(recordToRow(data.lastSession, "session"));
  }
  if (setRows.length > 0) {
    const { error } = await sb
      .from("vision_tag_sets")
      .upsert(setRows, { onConflict: "id,kind" });
    if (error) throw error;
  }
  if ((data.dictionary ?? []).length > 0) {
    const { error } = await sb
      .from("vision_tag_dictionary")
      .upsert(
        data.dictionary.map(dictToRow),
        { onConflict: "tag" },
      );
    if (error) throw error;
  }
  await trimHistory();
}

/** @deprecated No local cache — always reads live from Supabase. */
export async function syncLibraryFromRemote(): Promise<boolean> {
  return isTagLibraryReady();
}

/** @deprecated Writes already go to Supabase directly. */
export async function syncLibraryToRemote(): Promise<boolean> {
  return isTagLibraryReady();
}

/**
 * One-time import from the earlier Storage document (vision-library/library.json)
 * into Postgres tables, if tables are empty.
 */
export async function importFromStorageIfEmpty(): Promise<boolean> {
  try {
    if (!(await isTagLibraryReady())) return false;
    const hist = await listHistory();
    const fav = await listFavorites();
    const dict = await listDictionary();
    if (hist.length || fav.length || dict.length) return false;

    const sb = requireClient();
    const { data, error } = await sb.storage
      .from("vision-library")
      .download("library.json");
    if (error || !data) return false;
    const text = await data.text();
    if (!text.trim()) return false;
    const parsed = JSON.parse(text) as TagLibraryExport;
    if (parsed?.version !== 1) return false;
    await importLibrary(parsed, "merge");
    logInfo("imported storage library into postgres", {
      history: parsed.history?.length ?? 0,
      favorites: parsed.favorites?.length ?? 0,
      dict: parsed.dictionary?.length ?? 0,
    });
    return true;
  } catch (err) {
    logWarn("storage→db import skipped", describeError(err));
    return false;
  }
}
