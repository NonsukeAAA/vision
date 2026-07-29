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

/**
 * Tags that describe the sheet layout or a stock pose rather than the picture,
 * so they only steer generations away from the reference.
 */
const LAYOUT_NOISE_EXACT = new Set([
  "v",
  "double v",
  "multiple views",
  "multiple girls same face",
]);

export function isLayoutNoiseTag(tag: string): boolean {
  return LAYOUT_NOISE_EXACT.has(normalizeTag(tag));
}

/**
 * User-managed drop list, edited in settings.
 *
 * Module-level because filtering also runs inside the ONNX layer, which has no
 * access to app state; {@link setCustomDropTags} is called whenever settings change.
 */
const customDropTags = new Set<string>();

export function setCustomDropTags(tags: Iterable<string>): void {
  customDropTags.clear();
  for (const tag of tags) {
    const n = normalizeTag(tag);
    if (n) customDropTags.add(n);
  }
}

export function getCustomDropTags(): string[] {
  return [...customDropTags];
}

export function isCustomDropTag(tag: string): boolean {
  return customDropTags.has(normalizeTag(tag));
}

/** Tags removed from model output before showing / prompting. */
export function shouldDropOutputTag(tag: string): boolean {
  return (
    isCensorRelatedTag(tag) ||
    isMonoComicStyleTag(tag) ||
    isLayoutNoiseTag(tag) ||
    isCustomDropTag(tag)
  );
}

/**
 * Illustration-oriented quality boosters. Placed after `uncensored` and before
 * the model tags so SD / Illustrious-style checkpoints pick them up first.
 */
export const QUALITY_INSERT_TAGS = [
  "masterpiece",
  "best quality",
  "absurdres",
  "highres",
] as const;

/**
 * Night darkness + cinematic erotic mood — soft and intimate, not theatrical.
 * Avoids dramatic / high-contrast / spotlight cues that pull generations loud.
 */
export const ERO_BOOST_TAGS = [
  "night",
  "dark",
  "dim lighting",
  "cinematic lighting",
  "soft shadows",
  "depth of field",
  "intimate",
  "erotic",
  "sensual",
] as const;

/** Merge a preset pack into an insert list without duplicates. */
export function mergeInsertPreset(
  current: readonly string[],
  preset: readonly string[],
): string[] {
  const next = current.map((t) => normalizeTag(t)).filter(Boolean);
  const seen = new Set(next);
  for (const tag of preset) {
    const n = normalizeTag(tag);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    next.push(n);
  }
  return next;
}

/** Drop every tag from a preset pack (other custom tags stay). */
export function removeInsertPreset(
  current: readonly string[],
  preset: readonly string[],
): string[] {
  const drop = new Set(preset.map((t) => normalizeTag(t)));
  return current
    .map((t) => normalizeTag(t))
    .filter((t) => t && !drop.has(t));
}

export function insertPresetActive(
  current: readonly string[],
  preset: readonly string[],
): boolean {
  const have = new Set(current.map((t) => normalizeTag(t)));
  return preset.every((t) => have.has(normalizeTag(t)));
}

/** User-managed insert list, edited in settings. Same module-level reason as drops. */
const customInsertTags: string[] = [];
let insertQualityEnabled = true;

export function setCustomInsertTags(tags: Iterable<string>): void {
  customInsertTags.length = 0;
  const seen = new Set<string>();
  for (const tag of tags) {
    const n = normalizeTag(tag);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    customInsertTags.push(n);
  }
}

export function getCustomInsertTags(): string[] {
  return [...customInsertTags];
}

export function setInsertQualityEnabled(enabled: boolean): void {
  insertQualityEnabled = enabled;
}

export function isInsertQualityEnabled(): boolean {
  return insertQualityEnabled;
}

/** Forced prefix tags, in display order, without duplicates. */
export function forcedPrefixTags(): string[] {
  const out: string[] = ["uncensored"];
  const seen = new Set(out);
  if (insertQualityEnabled) {
    for (const tag of QUALITY_INSERT_TAGS) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
  }
  for (const tag of customInsertTags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Drop mosaic/censor and monochrome/comic tags; ensure `uncensored` and the
 * configured insert tags sit at the front.
 */
export function forceUncensoredTags(tags: TagScore[]): TagScore[] {
  const filtered = tags.filter((t) => !shouldDropOutputTag(t.tag));
  const prefix = forcedPrefixTags();
  const prefixSet = new Set(prefix);
  const withoutPrefix = filtered.filter(
    (t) => !prefixSet.has(normalizeTag(t.tag)),
  );
  return [
    ...prefix.map(
      (tag): TagScore => ({ tag, score: 1, category: "general" }),
    ),
    ...withoutPrefix,
  ];
}

/** Rebuild comma-separated prompt with noise tags removed and inserts first. */
export function forceUncensoredPrompt(prompt: string): string {
  const prefix = forcedPrefixTags();
  const prefixSet = new Set(prefix);
  const parts = prompt
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !shouldDropOutputTag(p))
    .filter((p) => !prefixSet.has(normalizeTag(p)));
  return [...prefix, ...parts].join(", ");
}
