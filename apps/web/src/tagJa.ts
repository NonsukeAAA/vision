import { normalizeTag } from "./forceUncensored";

type JaMap = Record<string, string>;

let map: JaMap | null = null;
let loading: Promise<JaMap> | null = null;

function dictUrl(): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  return `${base}i18n/danbooru-ja.json`;
}

async function loadMap(): Promise<JaMap> {
  if (map) return map;
  if (!loading) {
    loading = (async () => {
      const res = await fetch(dictUrl());
      if (!res.ok) throw new Error(`tag JA dict HTTP ${res.status}`);
      const data = (await res.json()) as JaMap;
      map = data;
      return data;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/** Kick off dictionary download (safe to call often). */
export function ensureTagJaLoaded(): Promise<void> {
  return loadMap().then(() => undefined);
}

export function translateTag(tag: string): string | null {
  if (!map) return null;
  const key = normalizeTag(tag);
  if (!key) return null;
  return map[key] ?? null;
}

export function isTagJaReady(): boolean {
  return !!map;
}
