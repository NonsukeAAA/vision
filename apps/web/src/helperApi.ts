import { HELPER_BASE } from "./joyModels";
import { describeError, logInfo, logWarn } from "./diagnostics";

export type HelperStatus = {
  ok: boolean;
  running: boolean;
  apiReady: boolean;
  joyReady?: boolean;
  joyAvailable?: boolean;
  joyRepo?: string;
  backend?: "docker" | "python" | "none";
  message?: string;
  detail?: string;
};

async function helperFetch(
  path: string,
  init?: RequestInit,
  timeoutMs = 4000,
): Promise<Response> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(`${HELPER_BASE}${path}`, {
      ...init,
      signal: ac.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function pingHelper(): Promise<HelperStatus> {
  try {
    const res = await helperFetch("/status", { method: "GET" }, 2500);
    if (!res.ok) {
      return { ok: false, running: false, apiReady: false, message: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as HelperStatus;
    return { ...data, ok: true };
  } catch (err) {
    return {
      ok: false,
      running: false,
      apiReady: false,
      message: "ヘルパー未起動",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function startHelperApi(opts: {
  joyModelId: string;
  enableJoy: boolean;
}): Promise<HelperStatus> {
  logInfo("helper start request", {
    model: opts.joyModelId,
    joy: opts.enableJoy,
  });
  try {
    const res = await helperFetch(
      "/start",
      {
        method: "POST",
        body: JSON.stringify({
          joyModelId: opts.joyModelId,
          enableJoy: opts.enableJoy,
        }),
      },
      120_000,
    );
    const data = (await res.json().catch(() => ({}))) as HelperStatus & {
      error?: string;
    };
    if (!res.ok) {
      logWarn("helper start failed", { status: res.status, error: data.error });
      return {
        ok: false,
        running: false,
        apiReady: false,
        message: data.error || data.message || `起動失敗 (${res.status})`,
      };
    }
    return { ...data, ok: true };
  } catch (err) {
    logWarn("helper start unreachable", describeError(err));
    return {
      ok: false,
      running: false,
      apiReady: false,
      message:
        "ヘルパーに接続できません。先に VisionHelper.bat（Windows）または VisionHelper.command（Mac）を起動してください",
    };
  }
}

export async function stopHelperApi(): Promise<HelperStatus> {
  try {
    const res = await helperFetch("/stop", { method: "POST" }, 60_000);
    const data = (await res.json().catch(() => ({}))) as HelperStatus;
    return { ...data, ok: res.ok };
  } catch (err) {
    return {
      ok: false,
      running: false,
      apiReady: false,
      message: err instanceof Error ? err.message : "停止に失敗",
    };
  }
}
