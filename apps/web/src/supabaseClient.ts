import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describeError, logInfo, logWarn } from "./diagnostics";

/** Public project ref (safe to ship). */
export const SUPABASE_PROJECT_REF = "nmdlasnxevejggwmnjwm";

export const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  `https://${SUPABASE_PROJECT_REF}.supabase.co`;

const ENV_API_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  (import.meta.env.VITE_SUPABASE_API_KEY as string | undefined)?.trim() ||
  "";

/** Private Storage bucket used as the durable tag-library document store. */
export const LIBRARY_BUCKET = "vision-library";
export const LIBRARY_OBJECT = "library.json";

let client: SupabaseClient | null = null;
let activeKey = "";

export function resolveApiKey(settingsKey?: string): string {
  return (settingsKey?.trim() || ENV_API_KEY).trim();
}

export function isSupabaseConfigured(settingsKey?: string): boolean {
  return !!resolveApiKey(settingsKey);
}

/** New `sb_secret_…` keys or legacy service_role JWTs (role claim). */
export function isSecretApiKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (k.startsWith("sb_secret_")) return true;
  if (!k.startsWith("eyJ")) return false;
  try {
    const payload = JSON.parse(atob(k.split(".")[1] ?? "")) as {
      role?: string;
    };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function getSupabase(settingsKey?: string): SupabaseClient | null {
  const key = resolveApiKey(settingsKey);
  if (!key) {
    client = null;
    activeKey = "";
    return null;
  }
  if (!client || activeKey !== key) {
    client = createClient(SUPABASE_URL, key, {
      auth: {
        persistSession: !isSecretApiKey(key),
        autoRefreshToken: !isSecretApiKey(key),
        detectSessionInUrl: false,
        storageKey: "vision.supabase.auth",
      },
    });
    activeKey = key;
  }
  return client;
}

export type SyncStatus =
  | { state: "off"; detail: string }
  | { state: "ok"; detail: string }
  | { state: "error"; detail: string };

export async function ensureLibraryBucket(
  settingsKey?: string,
): Promise<boolean> {
  const sb = getSupabase(settingsKey);
  if (!sb) return false;
  const { data, error } = await sb.storage.getBucket(LIBRARY_BUCKET);
  if (data && !error) return true;
  const created = await sb.storage.createBucket(LIBRARY_BUCKET, {
    public: false,
    fileSizeLimit: 5 * 1024 * 1024,
  });
  if (created.error && !/already exists/i.test(created.error.message)) {
    logWarn("supabase bucket create failed", describeError(created.error));
    return false;
  }
  logInfo("supabase bucket ready", { bucket: LIBRARY_BUCKET });
  return true;
}

export async function probeSupabaseSync(
  settingsKey?: string,
): Promise<SyncStatus> {
  const key = resolveApiKey(settingsKey);
  if (!key) {
    return {
      state: "off",
      detail:
        "API キー未設定。Dashboard の secret（sb_secret_…）または anon を貼ってください。",
    };
  }
  const sb = getSupabase(key);
  if (!sb) {
    return { state: "off", detail: "クライアント初期化に失敗しました" };
  }
  try {
    const ok = await ensureLibraryBucket(key);
    if (!ok) {
      return {
        state: "error",
        detail: "Storage バケットを作成できませんでした（キー権限を確認）",
      };
    }
    // Prove read access (missing object is fine).
    const { error } = await sb.storage
      .from(LIBRARY_BUCKET)
      .download(LIBRARY_OBJECT);
    if (error && !/not found|404|Object not found/i.test(error.message)) {
      return { state: "error", detail: error.message };
    }
    const kind = isSecretApiKey(key) ? "secret" : "api";
    return {
      state: "ok",
      detail: `Supabase Storage 同期中 · ${SUPABASE_PROJECT_REF} (${kind})`,
    };
  } catch (err) {
    const msg = describeError(err).message;
    return {
      state: "error",
      detail: typeof msg === "string" && msg ? msg : "接続に失敗しました",
    };
  }
}
