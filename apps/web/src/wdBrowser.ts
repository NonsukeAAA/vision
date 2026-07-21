import * as ort from "onnxruntime-web/wasm";
import type { TagScore } from "./types";

/** Browser-friendly WD v3 (≈360MB). eva02-large is ≈1.3GB and hangs on mobile. */
const HF_REPO = "SmilingWolf/wd-vit-tagger-v3";
const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`;
const CACHE_NAME = "vision-wd-vit-v3-v1";
const MODEL_URL = `${HF_BASE}/model.onnx`;
const TAGS_URL = `${HF_BASE}/selected_tags.csv`;
const TARGET = 448;

type TagRow = { name: string; category: number };
export type LoadProgress = {
  phase: "idle" | "tags" | "model" | "init" | "ready" | "error";
  loaded: number;
  total: number;
  message: string;
};

type ProgressFn = (p: LoadProgress) => void;

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let tagsPromise: Promise<TagRow[]> | null = null;
let wasmConfigured = false;
let lastProgress: LoadProgress = {
  phase: "idle",
  loaded: 0,
  total: 0,
  message: "待機中",
};

function emit(cb: ProgressFn | undefined, p: LoadProgress) {
  lastProgress = p;
  cb?.(p);
}

export function getLoadProgress(): LoadProgress {
  return lastProgress;
}

function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|od|ad)/.test(navigator.userAgent);
}

/** Match JS↔WASM versions and force single-thread for Safari / GitHub Pages. */
function configureOrtWasm() {
  if (wasmConfigured) return;
  const ver = ort.env.versions?.web ?? "1.27.0";
  // MUST match installed onnxruntime-web JS (mismatch → _OrtGetInputOutputMetadata errors)
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ver}/dist/`;
  // Pages is not crossOriginIsolated — multi-thread WASM breaks on Safari.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  if (isAppleMobile()) {
    ort.env.wasm.simd = false;
  }
  wasmConfigured = true;
}

async function cacheMatch(url: string): Promise<Response | undefined> {
  try {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(url)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function cachePut(url: string, res: Response): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, res);
  } catch {
    // Quota / private mode — ignore
  }
}

async function fetchWithProgress(
  url: string,
  onProgress: ProgressFn | undefined,
  label: string,
): Promise<ArrayBuffer> {
  const cached = await cacheMatch(url);
  if (cached) {
    emit(onProgress, {
      phase: "model",
      loaded: 1,
      total: 1,
      message: `${label}（キャッシュ）`,
    });
    return cached.arrayBuffer();
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}の取得に失敗 (${res.status})`);

  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body) {
    const buf = await res.arrayBuffer();
    await cachePut(url, new Response(buf.slice(0)));
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    emit(onProgress, {
      phase: "model",
      loaded,
      total: total || loaded,
      message:
        total > 0
          ? `${label} ${Math.min(99, Math.round((loaded / total) * 100))}%`
          : `${label} ${(loaded / 1e6).toFixed(1)} MB`,
    });
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const buf = merged.buffer;
  await cachePut(
    url,
    new Response(buf.slice(0), {
      headers: { "Content-Type": "application/octet-stream" },
    }),
  );
  return buf;
}

async function loadTags(onProgress?: ProgressFn): Promise<TagRow[]> {
  if (!tagsPromise) {
    tagsPromise = (async () => {
      emit(onProgress, {
        phase: "tags",
        loaded: 0,
        total: 1,
        message: "タグ辞書を取得中…",
      });
      let text: string;
      const cached = await cacheMatch(TAGS_URL);
      if (cached) {
        text = await cached.text();
      } else {
        const res = await fetch(TAGS_URL);
        if (!res.ok) throw new Error("タグ辞書の取得に失敗しました");
        text = await res.text();
        await cachePut(
          TAGS_URL,
          new Response(text, { headers: { "Content-Type": "text/csv" } }),
        );
      }
      const lines = text.trim().split(/\r?\n/);
      const header = lines[0].split(",");
      const nameIdx = header.indexOf("name");
      const catIdx = header.indexOf("category");
      return lines.slice(1).map((line) => {
        const cols = line.split(",");
        return {
          name: cols[nameIdx],
          category: Number(cols[catIdx] ?? 0),
        };
      });
    })().catch((err) => {
      tagsPromise = null;
      throw err;
    });
  }
  return tagsPromise;
}

async function loadSession(
  onProgress?: ProgressFn,
): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      configureOrtWasm();
      emit(onProgress, {
        phase: "model",
        loaded: 0,
        total: 1,
        message: "WD モデルをダウンロード中（初回のみ・約360MB）…",
      });
      const modelBuf = await fetchWithProgress(MODEL_URL, onProgress, "モデル");
      emit(onProgress, {
        phase: "init",
        loaded: 1,
        total: 1,
        message: "ONNX ランタイム初期化中…",
      });

      const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), {
        executionProviders: ["wasm"],
      });
      emit(onProgress, {
        phase: "ready",
        loaded: 1,
        total: 1,
        message: "ブラウザ内 WD ViT 準備完了",
      });
      return session;
    })().catch((err) => {
      sessionPromise = null;
      emit(onProgress, {
        phase: "error",
        loaded: 0,
        total: 0,
        message: err instanceof Error ? err.message : "モデル読み込み失敗",
      });
      throw err;
    });
  }
  return sessionPromise;
}

async function imageToTensor(file: File): Promise<ort.Tensor> {
  const bitmap = await createImageBitmap(file);
  const size = Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = TARGET;
  canvas.height = TARGET;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, TARGET, TARGET);
  const scale = TARGET / size;
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  const x = (TARGET - w) / 2;
  const y = (TARGET - h) / 2;
  ctx.drawImage(bitmap, x, y, w, h);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, TARGET, TARGET);
  const float = new Float32Array(TARGET * TARGET * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    float[j] = data[i + 2];
    float[j + 1] = data[i + 1];
    float[j + 2] = data[i];
  }
  return new ort.Tensor("float32", float, [1, TARGET, TARGET, 3]);
}

export async function preloadWdBrowser(onProgress?: ProgressFn): Promise<void> {
  await loadTags(onProgress);
  await loadSession(onProgress);
}

export async function tagInBrowser(
  file: File,
  opts: {
    threshold: number;
    characterThreshold: number;
    includeRating: boolean;
  },
  onProgress?: ProgressFn,
): Promise<{ tags: TagScore[]; prompt: string }> {
  const [session, tags] = await Promise.all([
    loadSession(onProgress),
    loadTags(onProgress),
  ]);
  const input = await imageToTensor(file);
  const inputName = session.inputNames[0];
  const output = await session.run({ [inputName]: input });
  const out = output[session.outputNames[0]];
  const probs = out.data as Float32Array;

  const categoryMap: Record<number, string> = {
    0: "general",
    4: "character",
    9: "rating",
  };

  const results: TagScore[] = [];
  for (let i = 0; i < tags.length; i++) {
    const row = tags[i];
    const score = Number(probs[i]);
    const category = categoryMap[row.category] ?? "general";
    if (category === "rating" && !opts.includeRating) continue;
    const cut =
      category === "character" ? opts.characterThreshold : opts.threshold;
    if (score < cut) continue;
    results.push({
      tag: row.name.replaceAll("_", " "),
      score,
      category,
    });
  }
  results.sort((a, b) => b.score - a.score);
  return { tags: results, prompt: results.map((t) => t.tag).join(", ") };
}
