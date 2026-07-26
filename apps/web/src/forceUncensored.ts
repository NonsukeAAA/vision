import type { TagScore } from "./types";

/** Normalize Danbooru-style tag for comparison. */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
}

/**
 * Censor / mosaic related tags to strip.
 * "uncensored" is never treated as a censor tag.
 */
export function isCensorRelatedTag(tag: string): boolean {
  const n = normalizeTag(tag);
  if (!n) return false;
  if (n === "uncensored" || n.startsWith("uncensor")) return false;

  if (
    n === "censored" ||
    n === "mosaic" ||
    n === "pixelated" ||
    n === "pixelation"
  ) {
    return true;
  }

  // bar censor, mosaic censoring, hair censor, convenient censoring, etc.
  if (n.includes("censor") || n.includes("mosaic")) return true;
  if (n.includes("pixelat")) return true;

  return false;
}

/** Exact monochrome / manga-panel style tags to drop from output. */
const MONO_COMIC_EXACT = new Set([
  "monochrome",
  "grayscale",
  "greyscale",
  "comic",
  "manga",
  "4koma",
  "multiple 4koma",
  "black and white",
  "lineart",
  "line art",
  "sketch",
  "sepia",
  "high contrast",
  "limited palette",
  "comic panel",
  "manga panel",
  "speech bubble",
  "thought bubble",
  "spoken heart",
  "emphasis lines",
  "speed lines",
  "action lines",
  "halftone",
  "screentones",
  "screentone",
  "ben day dots",
  "faux traditional media",
]);

/**
 * Manga / monochrome / comic-panel style tags (exact or clear variants).
 */
export function isMonoComicStyleTag(tag: string): boolean {
  const n = normalizeTag(tag);
  if (!n) return false;
  if (MONO_COMIC_EXACT.has(n)) return true;

  // numbered koma strips
  if (/^\d+koma$/.test(n.replace(/\s+/g, ""))) return true;
  if (n.endsWith(" koma") || n.endsWith("koma")) return true;

  if (n.includes("monochrome") || n.includes("grayscale") || n.includes("greyscale")) {
    return true;
  }
  if (n.includes("speech bubble") || n.includes("thought bubble")) return true;
  if (n.includes("screentone") || n.includes("halftone")) return true;
  if (n.includes("comic panel") || n.includes("manga panel")) return true;

  // bare comic/manga as whole token already in EXACT; avoid stripping
  // "comic cover" style compounds that are clearly panel/media
  if (
    n.startsWith("comic ") ||
    n.endsWith(" comic") ||
    n.includes(" comic ")
  ) {
    return true;
  }

  return false;
}

/** Tags removed from model output before showing / prompting. */
export function shouldDropOutputTag(tag: string): boolean {
  return isCensorRelatedTag(tag) || isMonoComicStyleTag(tag);
}

/**
 * Drop mosaic/censor and monochrome/comic tags; ensure `uncensored` is present.
 */
export function forceUncensoredTags(tags: TagScore[]): TagScore[] {
  const filtered = tags.filter((t) => !shouldDropOutputTag(t.tag));
  const withoutUncensored = filtered.filter(
    (t) => normalizeTag(t.tag) !== "uncensored",
  );
  return [
    { tag: "uncensored", score: 1, category: "general" },
    ...withoutUncensored,
  ];
}

/** Rebuild comma-separated prompt with noise tags removed and uncensored first. */
export function forceUncensoredPrompt(prompt: string): string {
  const parts = prompt
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !shouldDropOutputTag(p))
    .filter((p) => normalizeTag(p) !== "uncensored");
  return ["uncensored", ...parts].join(", ");
}
