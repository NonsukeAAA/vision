import type { TagScore } from "./types";
import { normalizeTag } from "./forceUncensored";
import type { BrowserModelId } from "./browserModels";

export type TaggedByModel = {
  modelId: BrowserModelId;
  tags: TagScore[];
};

export type MergedTagScore = TagScore & {
  /** How many models predicted this tag */
  votes: number;
  sources: BrowserModelId[];
};

/**
 * Merge tag lists from multiple models.
 * Same tag (normalized) → keep max score, count votes, remember sources.
 * Sort: more votes first, then higher score.
 */
export function mergeTagScores(results: TaggedByModel[]): MergedTagScore[] {
  const map = new Map<string, MergedTagScore>();

  for (const { modelId, tags } of results) {
    for (const t of tags) {
      const key = normalizeTag(t.tag);
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          tag: t.tag.replaceAll("_", " "),
          score: t.score,
          category: t.category,
          votes: 1,
          sources: [modelId],
        });
        continue;
      }
      if (!existing.sources.includes(modelId)) {
        existing.votes += 1;
        existing.sources.push(modelId);
      }
      if (t.score > existing.score) {
        existing.score = t.score;
        // Prefer space-normalized display from higher-scoring hit
        existing.tag = t.tag.replaceAll("_", " ");
      }
      // Prefer character category if any model says so
      if (t.category === "character" && existing.category !== "character") {
        existing.category = "character";
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.votes !== a.votes) return b.votes - a.votes;
    return b.score - a.score;
  });
}

export function mergedToTagScores(merged: MergedTagScore[]): TagScore[] {
  return merged.map(({ tag, score, category }) => ({ tag, score, category }));
}
