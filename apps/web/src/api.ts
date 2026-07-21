import type { AppSettings, TagResult } from "./types";

export async function checkHealth(apiBase: string): Promise<{
  ok: boolean;
  joy_available?: boolean;
  wd_ready?: boolean;
  mock?: boolean;
  detail?: string;
}> {
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/health`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = await res.json();
    return {
      ok: true,
      joy_available: data.joy_available,
      wd_ready: data.wd_ready,
      mock: data.mock,
    };
  } catch (err) {
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

  const res = await fetch(`${settings.apiBase.replace(/\/$/, "")}/tag`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error ${res.status}`);
  }
  return (await res.json()) as TagResult;
}
