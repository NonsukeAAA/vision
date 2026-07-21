export type OutputMode = "booru" | "caption" | "hybrid";
export type InferenceEngine = "browser" | "local-api";

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
  threshold: number;
  characterThreshold: number;
  includeRating: boolean;
  enableJoy: boolean;
  enableWd: boolean;
};

const STORAGE_KEY = "vision.settings.v1";

export const defaultSettings = (): AppSettings => ({
  engine: "browser",
  apiBase: "http://127.0.0.1:8000",
  mode: "hybrid",
  threshold: 0.35,
  characterThreshold: 0.85,
  includeRating: false,
  enableJoy: true,
  enableWd: true,
});

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
