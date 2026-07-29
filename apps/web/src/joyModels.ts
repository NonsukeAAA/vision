/**
 * JoyCaption Hugging Face repos the helper / local API can load.
 * Keep in sync with helper-windows/models.json.
 */
export const JOY_CAPTION_MODELS = [
  {
    id: "beta-one",
    repo: "fancyfeast/llama-joycaption-beta-one-hf-llava",
    label: "JoyCaption Beta One（推奨）",
    hint: "現行版 · 表情・情景に強い · 約 16GB+",
  },
  {
    id: "alpha-two",
    repo: "fancyfeast/llama-joycaption-alpha-two-hf-llava",
    label: "JoyCaption Alpha Two",
    hint: "一つ前の世代 · Beta より軽めな場合あり",
  },
] as const;

export type JoyCaptionModelId = (typeof JOY_CAPTION_MODELS)[number]["id"];

export const DEFAULT_JOY_CAPTION_MODEL: JoyCaptionModelId = "beta-one";

export function isJoyCaptionModelId(value: unknown): value is JoyCaptionModelId {
  return (
    typeof value === "string" &&
    JOY_CAPTION_MODELS.some((m) => m.id === value)
  );
}

export function joyCaptionRepoForId(id: string): string {
  const found = JOY_CAPTION_MODELS.find((m) => m.id === id);
  return found?.repo ?? JOY_CAPTION_MODELS[0].repo;
}

/** Local helper control plane (Windows resident). */
export const HELPER_BASE = "http://127.0.0.1:8765";
export const HELPER_DOWNLOAD_PATH = "helper/vision-helper-windows.zip";
