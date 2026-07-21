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

/**
 * Drop mosaic/censor tags and ensure `uncensored` is present (forced, score 1).
 */
export function forceUncensoredTags(tags: TagScore[]): TagScore[] {
  const filtered = tags.filter((t) => !isCensorRelatedTag(t.tag));
  const withoutUncensored = filtered.filter(
    (t) => normalizeTag(t.tag) !== "uncensored",
  );
  return [
    { tag: "uncensored", score: 1, category: "general" },
    ...withoutUncensored,
  ];
}

/** Rebuild comma-separated prompt with censor tags removed and uncensored first. */
export function forceUncensoredPrompt(prompt: string): string {
  const parts = prompt
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !isCensorRelatedTag(p))
    .filter((p) => normalizeTag(p) !== "uncensored");
  return ["uncensored", ...parts].join(", ");
}
