/**
 * Fetch Danbooru EN→JA tag dictionary (MIT: boorutan/booru-japanese-tag)
 * and write a compact JSON map keyed by normalized tags (spaces, lowercase).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC =
  "https://raw.githubusercontent.com/boorutan/booru-japanese-tag/main/danbooru-machine-jp.csv";
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public", "i18n");
const outPath = join(outDir, "danbooru-ja.json");

function normalize(tag) {
  return String(tag)
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ");
}

const res = await fetch(SRC);
if (!res.ok) {
  console.error(`[fetch-tag-ja] ${res.status} ${SRC}`);
  process.exit(1);
}
const text = await res.text();
const map = Object.create(null);
let count = 0;
for (const line of text.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const comma = line.indexOf(",");
  if (comma <= 0) continue;
  const en = normalize(line.slice(0, comma));
  const ja = line.slice(comma + 1).trim();
  if (!en || !ja) continue;
  // Prefer the first (usually hand / higher quality) when duplicates appear.
  if (map[en]) continue;
  map[en] = ja;
  count += 1;
}

// App-specific insert / quality tags not always in the dictionary.
const extras = {
  uncensored: "無修正",
  masterpiece: "傑作",
  "best quality": "最高品質",
  absurdres: "超高解像度",
  highres: "高解像度",
  "dim lighting": "薄暗い照明",
  "cinematic lighting": "シネマティック照明",
  "soft shadows": "柔らかい影",
  "depth of field": "被写界深度",
  "shallow depth of field": "浅い被写界深度",
  bokeh: "ボケ",
  "blurry background": "背景ボケ",
  "selective focus": "選択的フォーカス",
  intimate: "親密",
  erotic: "エロティック",
  sensual: "官能的",
  "veiny huge insertion": "血管の浮いた大きな挿入",
  newest: "最新",
  "amazing quality": "驚異的な品質",
  "very aesthetic": "非常に美しい",
  "intricate details": "細密なディテール",
  "anime coloring": "アニメ塗り",
  illustration: "イラスト",
  detailed: "詳細",
};
for (const [k, v] of Object.entries(extras)) {
  if (!map[k]) map[k] = v;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, JSON.stringify(map), "utf8");
console.log(`[fetch-tag-ja] wrote ${count}+ extras → ${outPath}`);
