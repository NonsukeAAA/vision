import { normalizeTag } from "./forceUncensored";

type JaMap = Record<string, string>;

let map: JaMap | null = null;
let loading: Promise<JaMap> | null = null;

/**
 * Clearer glosses for common WD/Danbooru tags (override machine JP when awkward).
 * Keys must be normalized (lowercase, spaces).
 */
const FRIENDLY_JA: JaMap = {
  "1girl": "女の子1人",
  "1boy": "男の子1人",
  "2girls": "女の子2人",
  "3girls": "女の子3人",
  "multiple girls": "複数の女の子",
  solo: "一人だけ",
  "solo focus": "一人にフォーカス",
  "looking at viewer": "こちらを見ている",
  smile: "笑顔",
  blush: "赤面",
  open_mouth: "口を開けている",
  "open mouth": "口を開けている",
  closed_mouth: "口を閉じている",
  "closed mouth": "口を閉じている",
  teeth: "歯が見える",
  tongue: "舌",
  "tongue out": "舌を出している",
  "long hair": "ロングヘア",
  "short hair": "ショートヘア",
  "very long hair": "かなり長い髪",
  bangs: "前髪",
  "ahoge": "アホ毛",
  "twintails": "ツインテール",
  "ponytail": "ポニーテール",
  "braid": "三つ編み",
  "sidelocks": "サイドロック",
  "hair between eyes": "目の間に髪",
  "blue eyes": "青い目",
  "brown eyes": "茶色い目",
  "green eyes": "緑の目",
  "red eyes": "赤い目",
  "purple eyes": "紫の目",
  "yellow eyes": "黄色い目",
  "black hair": "黒髪",
  "blonde hair": "金髪",
  "brown hair": "茶髪",
  "blue hair": "青髪",
  "pink hair": "ピンク髪",
  "white hair": "白髪",
  "purple hair": "紫髪",
  "red hair": "赤髪",
  "large breasts": "巨乳",
  "medium breasts": "普通の胸",
  "small breasts": "貧乳",
  "huge breasts": "超巨乳",
  navel: "へそ",
  cleavage: "胸の谷間",
  thighs: "太もも",
  "bare shoulders": "肩出し",
  "collarbone": "鎖骨",
  "midriff": "お腹見せ",
  "skirt": "スカート",
  "miniskirt": "ミニスカート",
  dress: "ドレス",
  shirt: "シャツ",
  "white shirt": "白いシャツ",
  "black shirt": "黒いシャツ",
  blouse: "ブラウス",
  jacket: "ジャケット",
  coat: "コート",
  pantyhose: "パンスト",
  stockings: "ストッキング",
  "thighhighs": "サイハイソックス",
  boots: "ブーツ",
  shoes: "靴",
  gloves: "手袋",
  hat: "帽子",
  ribbon: "リボン",
  bow: "ボウ",
  "bowtie": "蝶ネクタイ",
  jewelry: "アクセサリー",
  earrings: "ピアス",
  necklace: "ネックレス",
  choker: "チョーカー",
  "simple background": "シンプルな背景",
  "white background": "白い背景",
  "grey background": "灰色の背景",
  "blue background": "青い背景",
  outdoors: "屋外",
  indoors: "屋内",
  sky: "空",
  cloud: "雲",
  "day": "昼",
  night: "夜",
  "from above": "上から見た構図",
  "from below": "下から見た構図",
  "from side": "横から見た構図",
  "upper body": "上半身",
  "lower body": "下半身",
  "full body": "全身",
  "cowboy shot": "膝上くらいの構図",
  portrait: "顔〜胸元の構図",
  sitting: "座っている",
  standing: "立っている",
  lying: "寝そべっている",
  kneeling: "膝立ち",
  walking: "歩いている",
  running: "走っている",
  holding: "何かを持っている",
  "hands up": "両手を上げている",
  "arm up": "腕を上げている",
  "arms up": "両腕を上げている",
  "hand on own hip": "腰に手",
  "v": "ピースサイン",
  peace: "ピース",
  "heart hands": "手でハート",
  "breast focus": "胸フォーカス",
  "ass focus": "お尻フォーカス",
  "face focus": "顔フォーカス",
  "eye contact": "目が合っている",
  sweat: "汗",
  tears: "涙",
  "wet": "濡れている",
  steam: "湯気",
  "parted lips": "唇を少し開けている",
  "half-closed eyes": "半目",
  "closed eyes": "目を閉じている",
  "one eye closed": "ウインク",
  "mole": "ほくろ",
  freckles: "そばかす",
  "fang": "八重歯",
  "animal ears": "獣耳",
  "cat ears": "猫耳",
  "fox ears": "狐耳",
  tail: "しっぽ",
  "cat tail": "猫しっぽ",
  wings: "翼",
  halo: "頭上の輪",
  horns: "角",
  "pointy ears": "とがった耳",
  uncensored: "無修正",
  masterpiece: "傑作",
  "best quality": "最高品質",
  highres: "高解像度",
  absurdres: "超高解像度",
  newest: "最新",
  illustration: "イラスト",
  detailed: "詳細",
  "intricate details": "細かいディテール",
  "anime coloring": "アニメ塗り",
  "cinematic lighting": "映画みたいな光",
  "dim lighting": "薄暗い光",
  "soft shadows": "やわらかい影",
  "depth of field": "背景ボケ寄り",
  "shallow depth of field": "浅い被写界深度",
  bokeh: "ボケ",
  "blurry background": "背景がぼやけている",
  intimate: "親密な雰囲気",
  erotic: "エロい雰囲気",
  sensual: "官能的",
};

function dictUrl(): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  return `${base}i18n/danbooru-ja.json`;
}

async function loadMap(): Promise<JaMap> {
  if (map) return map;
  if (!loading) {
    loading = (async () => {
      const res = await fetch(dictUrl());
      if (!res.ok) throw new Error(`tag JA dict HTTP ${res.status}`);
      const data = (await res.json()) as JaMap;
      map = data;
      return data;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/** Kick off dictionary download (safe to call often). */
export function ensureTagJaLoaded(): Promise<void> {
  return loadMap().then(() => undefined);
}

/** Built-in / machine gloss (no custom overrides). */
export function translateTag(tag: string): string | null {
  const key = normalizeTag(tag);
  if (!key) return null;
  if (FRIENDLY_JA[key]) return FRIENDLY_JA[key];
  if (!map) return null;
  return map[key] ?? null;
}

/**
 * Prefer user customJa, then friendly overrides, then machine dict.
 * `customJa` keys should already be normalized when possible.
 */
export function resolveTagJa(
  tag: string,
  customJa?: Record<string, string>,
): string | null {
  const key = normalizeTag(tag);
  if (!key) return null;
  const custom =
    customJa?.[key]?.trim() ||
    customJa?.[tag]?.trim() ||
    customJa?.[tag.trim().toLowerCase()]?.trim();
  if (custom) return custom;
  return translateTag(tag);
}

export function isTagJaReady(): boolean {
  return !!map;
}
