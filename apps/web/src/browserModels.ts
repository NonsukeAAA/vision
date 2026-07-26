/**
 * Browser ONNX taggers for vision.
 *
 * WD v3 family: pad-square BGR NHWC — iPhone-friendly sizes (~170–380MB).
 * PixAI v0.9: EVA02-based, RGB NCHW normalized — stronger characters / newer IPs,
 * but ~1.2GB (PC / high-memory only; may fail on iPhone Safari).
 *
 * Note: FP32 SwinV2 (~446MB) OOMs at InferenceSession.create in most browsers;
 * we ship the public INT8 build instead (~167MB).
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
  hfRepo: string;
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
    // Full FP32 (~446MB) kills tabs at init (JS+WASM ≈900MB). Use public INT8 build.
    hfRepo: "KidiXDev/wd-swinv2-tagger-v3-quint8",
    sizeMb: 167,
    mobileFriendly: true,
    qualityRank: 3,
  },
  "pixai-v09": {
    id: "pixai-v09",
    family: "pixai",
    label: "PixAI Tagger v0.9",
    shortLabel: "PixAI",
    description: "キャラ・新作IPに強い · 約1.2GB · PC推奨",
    hfRepo: "deepghs/pixai-tagger-v0.9-onnx",
    sizeMb: 1212,
    mobileFriendly: false,
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
