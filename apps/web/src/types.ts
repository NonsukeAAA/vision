import {
  DEFAULT_BROWSER_MODEL,
  DEFAULT_ENSEMBLE_MODELS,
  isBrowserModelId,
  resolveBrowserModel,
  sanitizeEnsembleModels,
  type BrowserModelId,
} from "./browserModels";
import { isGrokModelId } from "./grokPrompt";
import {
  DEFAULT_JOY_CAPTION_MODEL,
  isJoyCaptionModelId,
} from "./joyModels";

export type OutputMode = "booru" | "caption" | "hybrid";
export type InferenceEngine = "browser" | "local-api";
export type TagRunMode = "single" | "merge";
export type { BrowserModelId };

export type TagScore = {
  tag: string;
  score: number;
  category: string;
};

export type TagResult = {
  mode: OutputMode;
  tags: TagScore[];
  prompt: string;
  caption: string | null;
  source: Record<string, string>;
  device: string;
  mock: boolean;
};

export type AppSettings = {
  engine: InferenceEngine;
  apiBase: string;
  mode: OutputMode;
  /** Single-model mode selection */
  browserModel: BrowserModelId;
  /** single = one model; merge = combine selected models */
  tagRunMode: TagRunMode;
  /** Models used when tagRunMode === "merge" */
  ensembleModels: BrowserModelId[];
  threshold: number;
  characterThreshold: number;
  includeRating: boolean;
  enableJoy: boolean;
  enableWd: boolean;
  /** Extra tags to strip from results, on top of the built-in rules. */
  dropTags: string[];
  /**
   * Extra tags prepended to every result (after uncensored / quality).
   * Edited from the insert-tags modal in settings.
   */
  insertTags: string[];
  /** When true, prepend illustration quality tags (masterpiece, best quality, …). */
  insertQualityTags: boolean;
  /**
   * xAI API key for Grok SD prompt generation (BYOK, pay-as-you-go).
   * Stored only in this browser's localStorage; never uploaded to our servers.
   */
  xaiApiKey: string;
  /** Grok model id used for prompt rewriting. */
  grokModel: string;
  /** JoyCaption HF model preset id (used by local helper / API). */
  joyCaptionModel: string;
  /** Show Japanese gloss under each result tag chip. */
  showTagJa: boolean;
  /**
   * Optional Supabase API key override. Empty = use the baked-in public key.
   * Kept for backwards compatibility; Settings no longer asks for this.
   */
  supabaseAnonKey: string;
};

/**
 * Stable key — schema changes must NOT rename this, or deploys look like a wipe.
 * Older `vision.settings.vN` keys are still read and folded in.
 */
const STORAGE_KEY = "vision.settings";
const BACKUP_KEY = "vision.settings.backup";
const LEGACY_STORAGE_KEYS = [
  "vision.settings.v7",
  "vision.settings.v6",
  "vision.settings.v5",
  "vision.settings.v4",
  "vision.settings.v3",
  "vision.settings.v2",
];

/** Guard against a pathological list slowing every tag filter. */
const MAX_TAG_LIST = 300;

/**
 * If an older ero-boost pack is already on the insert list, fold in any new
 * pack members (e.g. after a deploy) without forcing the preset on everyone.
 */
const ERO_BOOST_LEGACY_MARKERS = [
  "night",
  "dark",
  "dim lighting",
  "intimate",
  "erotic",
  "sensual",
] as const;

export function isGitHubPagesHost(): boolean {
  if (typeof window === "undefined") return false;
  return /\.github\.io$/i.test(window.location.hostname);
}

export const defaultSettings = (): AppSettings => ({
  engine: "browser",
  apiBase: "http://127.0.0.1:8000",
  mode: "hybrid",
  browserModel: DEFAULT_BROWSER_MODEL,
  tagRunMode: "single",
  ensembleModels: [...DEFAULT_ENSEMBLE_MODELS],
  threshold: 0.35,
  characterThreshold: 0.85,
  includeRating: false,
  enableJoy: true,
  enableWd: true,
  dropTags: [],
  insertTags: [],
  insertQualityTags: true,
  xaiApiKey: "",
  grokModel: "grok-3-mini",
  joyCaptionModel: DEFAULT_JOY_CAPTION_MODEL,
  showTagJa: true,
  supabaseAnonKey: "",
});

/** Trim, lowercase, de-duplicate and cap a user-entered tag list. */
export function sanitizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAG_LIST) break;
  }
  return [...seen];
}

/** @deprecated Prefer {@link sanitizeTagList}. Kept for call sites still named for drops. */
export function sanitizeDropTags(value: unknown): string[] {
  return sanitizeTagList(value);
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Newest source first. A later (older) blob only fills holes — empty strings /
 * empty arrays in a newer save never erase populated older values.
 */
function coalesceSettings(
  ...sources: Array<Record<string, unknown> | null>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [key, value] of Object.entries(src)) {
      if (value === undefined || value === null) continue;
      if (!(key in out)) {
        out[key] = value;
        continue;
      }
      const existing = out[key];
      if (typeof existing === "string" && existing.trim() === "") {
        if (typeof value === "string" && value.trim() !== "") out[key] = value;
        continue;
      }
      if (Array.isArray(existing) && existing.length === 0) {
        if (Array.isArray(value) && value.length > 0) out[key] = value;
      }
    }
  }
  return out;
}

/** Must stay in sync with ERO_BOOST_TAGS in forceUncensored.ts */
const ERO_BOOST_CURRENT = [
  "night",
  "dark",
  "dim lighting",
  "cinematic lighting",
  "soft shadows",
  "depth of field",
  "shallow depth of field",
  "bokeh",
  "blurry background",
  "selective focus",
  "intimate",
  "erotic",
  "sensual",
  "veiny huge insertion",
] as const;

function upgradeInsertPresets(tags: string[]): string[] {
  const have = new Set(tags);
  if (!ERO_BOOST_LEGACY_MARKERS.every((t) => have.has(t))) return tags;
  const next = [...tags];
  for (const tag of ERO_BOOST_CURRENT) {
    if (!have.has(tag)) {
      have.add(tag);
      next.push(tag);
    }
  }
  return next;
}

function normalizeSettings(parsed: Record<string, unknown> | null): AppSettings {
  const merged: AppSettings = parsed
    ? { ...defaultSettings(), ...(parsed as Partial<AppSettings>) }
    : defaultSettings();
  merged.browserModel = resolveBrowserModel(
    isBrowserModelId(merged.browserModel)
      ? merged.browserModel
      : DEFAULT_BROWSER_MODEL,
  );
  merged.tagRunMode = merged.tagRunMode === "merge" ? "merge" : "single";
  merged.ensembleModels = sanitizeEnsembleModels(merged.ensembleModels);
  merged.dropTags = sanitizeTagList(merged.dropTags);
  merged.insertTags = upgradeInsertPresets(sanitizeTagList(merged.insertTags));
  merged.insertQualityTags = merged.insertQualityTags !== false;
  merged.xaiApiKey =
    typeof merged.xaiApiKey === "string" ? merged.xaiApiKey.trim() : "";
  merged.grokModel = isGrokModelId(merged.grokModel)
    ? merged.grokModel
    : "grok-3-mini";
  merged.joyCaptionModel = isJoyCaptionModelId(merged.joyCaptionModel)
    ? merged.joyCaptionModel
    : DEFAULT_JOY_CAPTION_MODEL;
  merged.showTagJa = merged.showTagJa !== false;
  merged.supabaseAnonKey =
    typeof merged.supabaseAnonKey === "string"
      ? merged.supabaseAnonKey.trim()
      : "";
  // Pages may still use local-api when the Windows helper is running on :8000.
  return merged;
}

function allStoredBlobs(): Array<Record<string, unknown> | null> {
  // Newest → oldest. coalesceSettings applies in this order so newer wins,
  // while empty newer fields fall back to older populated ones.
  return [
    parseObject(readRaw(STORAGE_KEY)),
    parseObject(readRaw(BACKUP_KEY)),
    ...LEGACY_STORAGE_KEYS.map((key) => parseObject(readRaw(key))),
  ];
}

export function loadSettings(): AppSettings {
  try {
    const coalesced = coalesceSettings(...allStoredBlobs());
    const hasAny = Object.keys(coalesced).length > 0;
    const settings = normalizeSettings(hasAny ? coalesced : null);
    // Immediately rewrite to the stable key + backup so the next deploy never
    // depends on a versioned key that might get forgotten.
    if (hasAny) {
      persistAll(settings);
    }
    return settings;
  } catch {
    // Last resort: try backup alone before wiping to defaults.
    try {
      const backup = normalizeSettings(parseObject(readRaw(BACKUP_KEY)));
      if (backup.xaiApiKey || backup.insertTags.length || backup.dropTags.length) {
        persistAll(backup);
        return backup;
      }
    } catch {
      // ignore
    }
    return defaultSettings();
  }
}

function persistAll(settings: AppSettings): void {
  const payload = JSON.stringify(settings);
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    // quota / private mode
  }
  try {
    localStorage.setItem(BACKUP_KEY, payload);
  } catch {
    // ignore
  }
  // Keep the last versioned key in sync too, for older builds that only know v7.
  try {
    localStorage.setItem("vision.settings.v7", payload);
  } catch {
    // ignore
  }
}

export function saveSettings(settings: AppSettings): void {
  persistAll(settings);
}
