/**
 * Browser ONNX taggers for vision.
 *
 * WD v3 family: pad-square BGR NHWC — iPhone-friendly sizes (~170–380MB).
 * PixAI v0.9: EVA02-based, RGB NCHW normalized — character / newer IP focus.
 *
 * Heavy FP32 weights are swapped for INT8 builds where needed so tabs survive
 * InferenceSession.create (JS buffer + WASM copy ≈ 2× file size).
 */

export type BrowserModelId =
  | "wd-vit-v3"
  | "wd-convnext-v3"
  | "wd-swinv2-v3"
  | "pixai-v09";

export type ModelFamily = "wd-v3" | "pixai";

export type BrowserModelInfo = {
  id: BrowserModelId;
  family: ModelFamily;
  label: string;
  shortLabel: string;
  description: string;
  /** Hugging Face repo used for selected_tags.csv (and default model.onnx). */
  hfRepo: string;
  /**
   * Optional ONNX / split-manifest URL override (e.g. Pages-hosted INT8).
   * Absolute `https://…` or site-relative path (resolved via {@link modelOnnxUrl}).
   * Never pass BASE_URL alone into `new URL()` — it is path-only (`/vision/`).
   */
  modelUrl?: string;
  sizeMb: number;
  mobileFriendly: boolean;
  qualityRank: number;
};

export const BROWSER_MODELS: Record<BrowserModelId, BrowserModelInfo> = {
  "wd-vit-v3": {
    id: "wd-vit-v3",
    family: "wd-v3",
    label: "WD ViT Tagger v3",
    shortLabel: "ViT",
    description: "バランス型 · iPhone 推奨（約360MB）",
    hfRepo: "SmilingWolf/wd-vit-tagger-v3",
    sizeMb: 361,
    mobileFriendly: true,
    qualityRank: 1,
  },
  "wd-convnext-v3": {
    id: "wd-convnext-v3",
    family: "wd-v3",
    label: "WD ConvNeXt Tagger v3",
    shortLabel: "ConvNeXt",
    description: "別アーキテクチャ · 情景寄りの傾向（約377MB）",
    hfRepo: "SmilingWolf/wd-convnext-tagger-v3",
    sizeMb: 377,
    mobileFriendly: true,
    qualityRank: 2,
  },
  "wd-swinv2-v3": {
    id: "wd-swinv2-v3",
    family: "wd-v3",
    label: "WD SwinV2 Tagger v3 (INT8)",
    shortLabel: "SwinV2",
    description: "高精度寄り · ブラウザ用 INT8（約167MB）",
    hfRepo: "KidiXDev/wd-swinv2-tagger-v3-quint8",
    sizeMb: 167,
    mobileFriendly: true,
    qualityRank: 3,
  },
  "pixai-v09": {
    id: "pixai-v09",
    family: "pixai",
    label: "PixAI Tagger v0.9 (INT8)",
    shortLabel: "PixAI",
    description: "キャラ・新作IPに強い · ブラウザ用 INT8（約308MB）",
    // Tags/preprocess from deepghs; INT8 weights hosted as split parts on Pages (<100MB each).
    hfRepo: "deepghs/pixai-tagger-v0.9-onnx",
    modelUrl: "models/pixai-v09-int8.json",
    sizeMb: 308,
    mobileFriendly: true,
    qualityRank: 4,
  },
};

export const BROWSER_MODEL_LIST: BrowserModelInfo[] = Object.values(
  BROWSER_MODELS,
);

export const DEFAULT_BROWSER_MODEL: BrowserModelId = "wd-vit-v3";
export const DEFAULT_BROWSER_MODEL_IPHONE: BrowserModelId = "wd-vit-v3";
export const DEFAULT_ENSEMBLE_MODELS: BrowserModelId[] = [
  "wd-vit-v3",
  "wd-convnext-v3",
];

export function isBrowserModelId(v: unknown): v is BrowserModelId {
  return typeof v === "string" && v in BROWSER_MODELS;
}

export function isAppleMobileUa(
  ua = typeof navigator !== "undefined" ? navigator.userAgent : "",
): boolean {
  return /iP(hone|od|ad)/.test(ua);
}

export function resolveBrowserModel(
  preferred: unknown,
  ua?: string,
): BrowserModelId {
  if (isBrowserModelId(preferred)) {
    if (isAppleMobileUa(ua) && !BROWSER_MODELS[preferred].mobileFriendly) {
      return DEFAULT_BROWSER_MODEL_IPHONE;
    }
    return preferred;
  }
  return isAppleMobileUa(ua)
    ? DEFAULT_BROWSER_MODEL_IPHONE
    : DEFAULT_BROWSER_MODEL;
}

export function sanitizeEnsembleModels(
  models: unknown,
  ua?: string,
): BrowserModelId[] {
  const list = Array.isArray(models)
    ? models.filter(isBrowserModelId)
    : [...DEFAULT_ENSEMBLE_MODELS];
  const unique = [...new Set(list)];
  const filtered = isAppleMobileUa(ua)
    ? unique.filter((id) => BROWSER_MODELS[id].mobileFriendly)
    : unique;
  return filtered.length > 0 ? filtered : [DEFAULT_BROWSER_MODEL_IPHONE];
}

export function modelHfBase(id: BrowserModelId): string {
  return `https://huggingface.co/${BROWSER_MODELS[id].hfRepo}/resolve/main`;
}

/** Join Vite BASE_URL (path-only) with a relative asset path — no `new URL()`. */
export function siteAssetPath(relativePath: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${relativePath.replace(/^\//, "")}`;
}

/**
 * Absolute URL for site assets. Uses `location.origin` when available so callers
 * never need `new URL(rel, BASE_URL)` (BASE_URL is not a valid URL base).
 */
export function siteAssetUrl(relativePath: string): string {
  const path = siteAssetPath(relativePath);
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(path, window.location.origin).href;
  }
  return path;
}

/** ONNX weight URL (Pages INT8 override or Hugging Face). */
export function modelOnnxUrl(id: BrowserModelId): string {
  const info = BROWSER_MODELS[id];
  if (info.modelUrl) {
    if (/^https?:\/\//i.test(info.modelUrl)) return info.modelUrl;
    return siteAssetUrl(info.modelUrl);
  }
  return `${modelHfBase(id)}/model.onnx`;
}
