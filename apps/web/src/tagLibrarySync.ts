/**
 * Supabase sync layer for the tag library.
 * IndexedDB remains the offline cache; Supabase is the durable remote store.
 */

import { describeError, logInfo, logWarn } from "./diagnostics";
import { ensureSupabaseUser, getSupabase } from "./supabaseClient";
import type { DictEntry, TagSetRecord } from "./tagLibrary";
import type { OutputMode, TagScore } from "./types";

type SetKind = "history" | "favorite" | "session";

type SetRow = {
  id: string;
  user_id: string;
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
  user_id: string;
  tag: string;
  category: string;
  last_score: number;
  count: number;
  custom_ja: string;
  note: string;
  updated_at: string;
};

let anonKeyProvider: () => string = () => "";

/** App wires this so sync reads the latest settings key. */
export function setSupabaseAnonKeyProvider(fn: () => string): void {
  anonKeyProvider = fn;
}

function key(): string {
  return anonKeyProvider();
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

function recordToRow(
  record: TagSetRecord,
  userId: string,
  kind: SetKind,
): SetRow {
  return {
    id: record.id,
    user_id: userId,
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

async function authed() {
  const sb = getSupabase(key());
  if (!sb) return null;
  const uid = await ensureSupabaseUser(key());
  if (!uid) return null;
  return { sb, uid };
}

export async function remoteUpsertSet(
  record: TagSetRecord,
  kind: SetKind,
): Promise<void> {
  const ctx = await authed();
  if (!ctx) return;
  const { sb, uid } = ctx;
  const row = recordToRow(record, uid, kind);
  if (kind === "session") {
    // Keep a single session row: delete others then upsert.
    await sb
      .from("vision_tag_sets")
      .delete()
      .eq("user_id", uid)
      .eq("kind", "session")
      .neq("id", record.id);
  }
  const { error } = await sb
    .from("vision_tag_sets")
    .upsert(row, { onConflict: "id,kind" });
  if (error) throw error;
}

export async function remoteDeleteSet(
  id: string,
  kind?: SetKind,
): Promise<void> {
  const ctx = await authed();
  if (!ctx) return;
  let q = ctx.sb.from("vision_tag_sets").delete().eq("id", id).eq("user_id", ctx.uid);
  if (kind) q = q.eq("kind", kind);
  const { error } = await q;
  if (error) throw error;
}

export async function remoteUpsertDict(entry: DictEntry): Promise<void> {
  const ctx = await authed();
  if (!ctx) return;
  const row: DictRow = {
    user_id: ctx.uid,
    tag: entry.tag,
    category: entry.category,
    last_score: entry.lastScore,
    count: entry.count,
    custom_ja: entry.customJa,
    note: entry.note,
    updated_at: toIso(entry.updatedAt),
  };
  const { error } = await ctx.sb
    .from("vision_tag_dictionary")
    .upsert(row, { onConflict: "user_id,tag" });
  if (error) throw error;
}

export async function remoteDeleteDict(tag: string): Promise<void> {
  const ctx = await authed();
  if (!ctx) return;
  const { error } = await ctx.sb
    .from("vision_tag_dictionary")
    .delete()
    .eq("user_id", ctx.uid)
    .eq("tag", tag);
  if (error) throw error;
}

export async function remoteUpsertDictTags(tags: TagScore[]): Promise<void> {
  if (tags.length === 0) return;
  const ctx = await authed();
  if (!ctx) return;
  const now = Date.now();
  // Read existing counts then upsert — small batches are fine for tag sets.
  const keys = [...new Set(tags.map((t) => t.tag.trim().toLowerCase().replaceAll("_", " ")).filter(Boolean))];
  const { data: existing, error: readErr } = await ctx.sb
    .from("vision_tag_dictionary")
    .select("*")
    .eq("user_id", ctx.uid)
    .in("tag", keys);
  if (readErr) throw readErr;
  const map = new Map<string, DictRow>();
  for (const row of (existing ?? []) as DictRow[]) map.set(row.tag, row);
  const rows: DictRow[] = [];
  for (const t of tags) {
    const tag = t.tag.trim().toLowerCase().replaceAll("_", " ");
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
          user_id: ctx.uid,
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
  const { error } = await ctx.sb
    .from("vision_tag_dictionary")
    .upsert(rows, { onConflict: "user_id,tag" });
  if (error) throw error;
}

export type RemoteLibrary = {
  history: TagSetRecord[];
  favorites: TagSetRecord[];
  dictionary: DictEntry[];
  lastSession: TagSetRecord | null;
};

export async function pullRemoteLibrary(): Promise<RemoteLibrary | null> {
  const ctx = await authed();
  if (!ctx) return null;
  const { sb, uid } = ctx;
  const [setsRes, dictRes] = await Promise.all([
    sb.from("vision_tag_sets").select("*").eq("user_id", uid),
    sb.from("vision_tag_dictionary").select("*").eq("user_id", uid),
  ]);
  if (setsRes.error) throw setsRes.error;
  if (dictRes.error) throw dictRes.error;
  const sets = (setsRes.data ?? []) as SetRow[];
  const history = sets
    .filter((r) => r.kind === "history")
    .map(rowToRecord)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
  const favorites = sets
    .filter((r) => r.kind === "favorite")
    .map(rowToRecord)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const sessionRow = sets.find((r) => r.kind === "session");
  const dictionary: DictEntry[] = ((dictRes.data ?? []) as DictRow[]).map(
    (r) => ({
      tag: r.tag,
      category: r.category,
      lastScore: r.last_score,
      count: r.count,
      customJa: r.custom_ja,
      note: r.note,
      updatedAt: fromIso(r.updated_at),
    }),
  );
  logInfo("supabase pull", {
    history: history.length,
    favorites: favorites.length,
    dict: dictionary.length,
  });
  return {
    history,
    favorites,
    dictionary,
    lastSession: sessionRow ? rowToRecord(sessionRow) : null,
  };
}

export async function pushFullLibrary(data: {
  history: TagSetRecord[];
  favorites: TagSetRecord[];
  dictionary: DictEntry[];
  lastSession: TagSetRecord | null;
}): Promise<void> {
  const ctx = await authed();
  if (!ctx) return;
  const { sb, uid } = ctx;
  const rows: SetRow[] = [
    ...data.history.map((r) => recordToRow(r, uid, "history")),
    ...data.favorites.map((r) => recordToRow(r, uid, "favorite")),
  ];
  if (data.lastSession) {
    rows.push(recordToRow(data.lastSession, uid, "session"));
  }
  if (rows.length > 0) {
    const { error } = await sb
      .from("vision_tag_sets")
      .upsert(rows, { onConflict: "id,kind" });
    if (error) throw error;
  }
  if (data.dictionary.length > 0) {
    const dictRows: DictRow[] = data.dictionary.map((e) => ({
      user_id: uid,
      tag: e.tag,
      category: e.category,
      last_score: e.lastScore,
      count: e.count,
      custom_ja: e.customJa,
      note: e.note,
      updated_at: toIso(e.updatedAt),
    }));
    const { error } = await sb
      .from("vision_tag_dictionary")
      .upsert(dictRows, { onConflict: "user_id,tag" });
    if (error) throw error;
  }
  // Trim remote history beyond 100.
  const { data: hist, error: histErr } = await sb
    .from("vision_tag_sets")
    .select("id, created_at")
    .eq("user_id", uid)
    .eq("kind", "history")
    .order("created_at", { ascending: false });
  if (histErr) throw histErr;
  const extra = (hist ?? []).slice(100);
  if (extra.length > 0) {
    const { error } = await sb
      .from("vision_tag_sets")
      .delete()
      .in(
        "id",
        extra.map((r) => r.id),
      );
    if (error) throw error;
  }
  logInfo("supabase push full", {
    sets: rows.length,
    dict: data.dictionary.length,
  });
}

export async function safeSync(label: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    logWarn(`supabase ${label} failed`, describeError(err));
  }
}
