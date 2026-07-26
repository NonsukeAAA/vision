import {
  DEFAULT_BROWSER_MODEL,
  DEFAULT_ENSEMBLE_MODELS,
  isBrowserModelId,
  resolveBrowserModel,
  sanitizeEnsembleModels,
  type BrowserModelId,
} from "./browserModels";

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
};

const STORAGE_KEY = "vision.settings.v5";
const LEGACY_STORAGE_KEYS = [
  "vision.settings.v4",
  "vision.settings.v3",
  "vision.settings.v2",
];
/** Guard against a pathological list slowing every tag filter. */
const MAX_DROP_TAGS = 300;

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
});

/** Trim, lowercase, de-duplicate and cap a user-entered drop list. */
export function sanitizeDropTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
    if (tag) seen.add(tag);
    if (seen.size >= MAX_DROP_TAGS) break;
  }
  return [...seen];
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const legacy = raw
      ? null
      : LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(
          (v) => !!v,
        ) ?? null;
    const parsed = raw
      ? JSON.parse(raw)
      : legacy
        ? JSON.parse(legacy)
        : null;
    const merged: AppSettings = parsed
      ? { ...defaultSettings(), ...parsed }
      : defaultSettings();
    merged.browserModel = resolveBrowserModel(
      isBrowserModelId(merged.browserModel)
        ? merged.browserModel
        : DEFAULT_BROWSER_MODEL,
    );
    merged.tagRunMode =
      merged.tagRunMode === "merge" ? "merge" : "single";
    merged.ensembleModels = sanitizeEnsembleModels(merged.ensembleModels);
    merged.dropTags = sanitizeDropTags(merged.dropTags);
    if (isGitHubPagesHost() && merged.engine === "local-api") {
      return { ...merged, engine: "browser" };
    }
    return merged;
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
