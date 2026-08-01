import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describeError } from "./diagnostics";

/** Public project ref (safe to ship). */
export const SUPABASE_PROJECT_REF = "nmdlasnxevejggwmnjwm";

export const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  `https://${SUPABASE_PROJECT_REF}.supabase.co`;

/**
 * Public publishable / anon key — baked into the client so Settings is optional.
 * Tables are opened to `anon` via RLS for this personal app.
 */
const DEFAULT_PUBLIC_API_KEY =
  "sb_publishable_4qtStRRg_8wc_VkJ01yalw_0zEi0nmn";

const ENV_API_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  (import.meta.env.VITE_SUPABASE_API_KEY as string | undefined)?.trim() ||
  "";

let client: SupabaseClient | null = null;
let activeKey = "";

export function resolveApiKey(settingsKey?: string): string {
  return (
    settingsKey?.trim() ||
    ENV_API_KEY ||
    DEFAULT_PUBLIC_API_KEY
  ).trim();
}

export function isSupabaseConfigured(settingsKey?: string): boolean {
  return !!resolveApiKey(settingsKey);
}

/** New `sb_secret_…` keys or legacy service_role JWTs. */
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
        persistSession: false,
        autoRefreshToken: false,
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

export async function probeSupabaseSync(
  settingsKey?: string,
): Promise<SyncStatus> {
  const key = resolveApiKey(settingsKey);
  if (!key) {
    return {
      state: "off",
      detail: "Supabase API キーがありません。",
    };
  }
  const sb = getSupabase(key);
  if (!sb) {
    return { state: "off", detail: "クライアント初期化に失敗しました" };
  }
  try {
    const { error } = await sb.from("vision_tag_sets").select("id").limit(1);
    if (error) {
      if (
        error.code === "PGRST205" ||
        /Could not find the table/i.test(error.message)
      ) {
        return {
          state: "error",
          detail:
            "テーブル未作成。下の「SQLをコピー」を Dashboard → SQL Editor で実行してください。",
        };
      }
      return { state: "error", detail: error.message };
    }
    return {
      state: "ok",
      detail: `Supabase DB 接続中 · ${SUPABASE_PROJECT_REF}`,
    };
  } catch (err) {
    const msg = describeError(err).message;
    return {
      state: "error",
      detail: typeof msg === "string" && msg ? msg : "接続に失敗しました",
    };
  }
}
