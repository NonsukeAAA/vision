import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describeError, logInfo, logWarn } from "./diagnostics";

/** Public project ref (safe to ship). */
export const SUPABASE_PROJECT_REF = "nmdlasnxevejggwmnjwm";

export const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  `https://${SUPABASE_PROJECT_REF}.supabase.co`;

const ENV_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "";

let client: SupabaseClient | null = null;
let activeAnonKey = "";
let ensuring: Promise<string | null> | null = null;

export function getSupabaseAnonKeyHint(): string {
  return ENV_ANON_KEY ? "build" : "";
}

export function resolveAnonKey(settingsKey?: string): string {
  const fromSettings = settingsKey?.trim() || "";
  return fromSettings || ENV_ANON_KEY;
}

export function isSupabaseConfigured(settingsKey?: string): boolean {
  return !!resolveAnonKey(settingsKey);
}

export function getSupabase(settingsKey?: string): SupabaseClient | null {
  const key = resolveAnonKey(settingsKey);
  if (!key) {
    client = null;
    activeAnonKey = "";
    return null;
  }
  if (!client || activeAnonKey !== key) {
    client = createClient(SUPABASE_URL, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "vision.supabase.auth",
      },
    });
    activeAnonKey = key;
  }
  return client;
}

/**
 * Prefer anonymous auth so RLS can scope rows by auth.uid().
 * Returns the user id, or null when Supabase is unavailable / anon disabled.
 */
export async function ensureSupabaseUser(
  settingsKey?: string,
): Promise<string | null> {
  const sb = getSupabase(settingsKey);
  if (!sb) return null;
  if (!ensuring) {
    ensuring = (async () => {
      try {
        const { data: existing, error: getErr } = await sb.auth.getSession();
        if (getErr) throw getErr;
        if (existing.session?.user?.id) {
          return existing.session.user.id;
        }
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) throw error;
        const uid = data.user?.id ?? null;
        if (uid) logInfo("supabase anon session", { uid: uid.slice(0, 8) });
        return uid;
      } catch (err) {
        logWarn("supabase auth failed", describeError(err));
        return null;
      } finally {
        ensuring = null;
      }
    })();
  }
  return ensuring;
}

export type SyncStatus =
  | { state: "off"; detail: string }
  | { state: "ok"; detail: string; userId: string }
  | { state: "error"; detail: string };

export async function probeSupabaseSync(
  settingsKey?: string,
): Promise<SyncStatus> {
  if (!isSupabaseConfigured(settingsKey)) {
    return {
      state: "off",
      detail:
        "Anon Key 未設定。設定に貼るか VITE_SUPABASE_ANON_KEY をビルドに渡してください。",
    };
  }
  const uid = await ensureSupabaseUser(settingsKey);
  if (!uid) {
    return {
      state: "error",
      detail:
        "Anonymous Sign-Ins を Dashboard で有効にするか、キーを確認してください。",
    };
  }
  return {
    state: "ok",
    detail: `同期中 · ${SUPABASE_PROJECT_REF}`,
    userId: uid,
  };
}
