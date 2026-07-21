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

const STORAGE_KEY = "vision.settings.v2";

export function isGitHubPagesHost(): boolean {
  if (typeof window === "undefined") return false;
  return /\.github\.io$/i.test(window.location.hostname);
}

export const defaultSettings = (): AppSettings => ({
  // GitHub Pages ではブラウザ内 WD14 が既定（ローカル API は別途起動が必要）
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
    const merged = raw
      ? { ...defaultSettings(), ...JSON.parse(raw) }
      : defaultSettings();
    // Pages 上で誤って local-api が残っていると解析不能になるため補正
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
