import { describeError, logInfo, logWarn } from "./diagnostics";
import type { AppSettings, TagResult } from "./types";

const HEALTH_TIMEOUT_MS = 4000;
const TAG_TIMEOUT_MS = 180_000;

/** A dead local API must fail fast instead of hanging the startup probe. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function checkHealth(apiBase: string): Promise<{
  ok: boolean;
  joy_available?: boolean;
  wd_ready?: boolean;
  mock?: boolean;
  detail?: string;
}> {
  try {
    const res = await fetchWithTimeout(
      `${apiBase.replace(/\/$/, "")}/health`,
      {},
      HEALTH_TIMEOUT_MS,
    );
    if (!res.ok) {
      logWarn("api health not ok", { status: res.status });
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    const data = await res.json();
    logInfo("api health ok", {
      joy: !!data.joy_available,
      wd: !!data.wd_ready,
      mock: !!data.mock,
    });
    return {
      ok: true,
      joy_available: data.joy_available,
      wd_ready: data.wd_ready,
      mock: data.mock,
    };
  } catch (err) {
    logWarn("api health unreachable", describeError(err));
    return { ok: false, detail: err instanceof Error ? err.message : "unreachable" };
  }
}

export async function tagViaApi(
  file: File,
  settings: AppSettings,
): Promise<TagResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", settings.mode);
  body.append("threshold", String(settings.threshold));
  body.append("character_threshold", String(settings.characterThreshold));
  body.append("include_rating", String(settings.includeRating));
  body.append("enable_joy", String(settings.enableJoy));
  body.append("enable_wd", String(settings.enableWd));

  const url = `${settings.apiBase.replace(/\/$/, "")}/tag`;
  logInfo("api tag request", { mode: settings.mode, joy: settings.enableJoy });
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: "POST", body }, TAG_TIMEOUT_MS);
  } catch (err) {
    logWarn("api tag request failed", describeError(err));
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("ローカル API が応答しません（タイムアウト）");
    }
    throw new Error(
      `ローカル API に接続できません（${settings.apiBase}）。起動状態を確認してください`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logWarn("api tag error response", { status: res.status, body: text.slice(0, 200) });
    throw new Error(text || `API error ${res.status}`);
  }
  try {
    return (await res.json()) as TagResult;
  } catch (err) {
    logWarn("api tag bad json", describeError(err));
    throw new Error("ローカル API の応答を解釈できませんでした");
  }
}
