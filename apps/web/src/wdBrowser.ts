import * as ort from "onnxruntime-web/wasm";
import type { TagScore } from "./types";
import { forceUncensoredTags } from "./forceUncensored";
import {
  BROWSER_MODELS,
  isAppleMobileUa,
  modelHfBase,
  type BrowserModelId,
} from "./browserModels";
import {
  mergeTagScores,
  mergedToTagScores,
  type TaggedByModel,
} from "./mergeTags";

const TARGET = 448;
const CACHE_PREFIX = "vision-tagger-v1";

type TagRow = { name: string; category: number };
export type LoadProgress = {
  phase: "idle" | "tags" | "model" | "init" | "ready" | "error";
  loaded: number;
  total: number;
  message: string;
  modelId?: BrowserModelId;
};

type ProgressFn = (p: LoadProgress) => void;

type ModelRuntime = {
  sessionPromise: Promise<ort.InferenceSession> | null;
  tagsPromise: Promise<TagRow[]> | null;
};

const runtimes = new Map<BrowserModelId, ModelRuntime>();
let activeModelId: BrowserModelId = "wd-vit-v3";
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

function getRuntime(id: BrowserModelId): ModelRuntime {
  let rt = runtimes.get(id);
  if (!rt) {
    rt = { sessionPromise: null, tagsPromise: null };
    runtimes.set(id, rt);
  }
  return rt;
}

export function getLoadProgress(): LoadProgress {
  return lastProgress;
}

export function getActiveBrowserModel(): BrowserModelId {
  return activeModelId;
}

export function clearBrowserModelRuntime(id?: BrowserModelId) {
  if (id) {
    runtimes.delete(id);
    return;
  }
  runtimes.clear();
}

function cacheName(id: BrowserModelId): string {
  return `${CACHE_PREFIX}-${id}`;
}

function configureOrtWasm() {
  if (wasmConfigured) return;
  const ver = ort.env.versions?.web ?? "1.27.0";
  // MUST match installed onnxruntime-web JS (mismatch → _OrtGetInputOutputMetadata errors)
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ver}/dist/`;
  // Pages is not crossOriginIsolated — multi-thread WASM breaks on Safari.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  if (isAppleMobileUa()) {
    ort.env.wasm.simd = false;
  }
  wasmConfigured = true;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function cacheMatch(
  id: BrowserModelId,
  url: string,
): Promise<Response | undefined> {
  try {
    const cache = await caches.open(cacheName(id));
    return (await cache.match(url)) ?? undefined;
  } catch {
    return undefined;
  }
}

async function cachePut(
  id: BrowserModelId,
  url: string,
  res: Response,
): Promise<void> {
  try {
    const cache = await caches.open(cacheName(id));
    await cache.put(url, res);
  } catch {
    // Quota / private mode — ignore
  }
}

async function fetchWithProgress(
  id: BrowserModelId,
  url: string,
  onProgress: ProgressFn | undefined,
  label: string,
): Promise<ArrayBuffer> {
  const cached = await cacheMatch(id, url);
  if (cached) {
    emit(onProgress, {
      phase: "model",
      loaded: 1,
      total: 1,
      message: `${label}（キャッシュ）`,
      modelId: id,
    });
    return cached.arrayBuffer();
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label}の取得に失敗 (${res.status})`);

  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body) {
    const buf = await res.arrayBuffer();
    await cachePut(id, url, new Response(buf.slice(0)));
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
      modelId: id,
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
    id,
    url,
    new Response(buf.slice(0), {
      headers: { "Content-Type": "application/octet-stream" },
    }),
  );
  return buf;
}

async function loadTags(
  modelId: BrowserModelId,
  onProgress?: ProgressFn,
): Promise<TagRow[]> {
  const rt = getRuntime(modelId);
  if (!rt.tagsPromise) {
    rt.tagsPromise = (async () => {
      const tagsUrl = `${modelHfBase(modelId)}/selected_tags.csv`;
      emit(onProgress, {
        phase: "tags",
        loaded: 0,
        total: 1,
        message: `${BROWSER_MODELS[modelId].shortLabel} タグ辞書を取得中…`,
        modelId,
      });
      let text: string;
      const cached = await cacheMatch(modelId, tagsUrl);
      if (cached) {
        text = await cached.text();
      } else {
        const res = await fetch(tagsUrl);
        if (!res.ok) throw new Error("タグ辞書の取得に失敗しました");
        text = await res.text();
        await cachePut(
          modelId,
          tagsUrl,
          new Response(text, { headers: { "Content-Type": "text/csv" } }),
        );
      }
      const lines = text.trim().split(/\r?\n/);
      const header = parseCsvLine(lines[0]);
      const nameIdx = header.indexOf("name");
      const catIdx = header.indexOf("category");
      return lines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        return {
          name: cols[nameIdx],
          category: Number(cols[catIdx] ?? 0),
        };
      });
    })().catch((err) => {
      rt.tagsPromise = null;
      throw err;
    });
  }
  return rt.tagsPromise;
}

async function loadSession(
  modelId: BrowserModelId,
  onProgress?: ProgressFn,
): Promise<ort.InferenceSession> {
  const rt = getRuntime(modelId);
  if (!rt.sessionPromise) {
    rt.sessionPromise = (async () => {
      configureOrtWasm();
      const info = BROWSER_MODELS[modelId];
      const modelUrl = `${modelHfBase(modelId)}/model.onnx`;
      emit(onProgress, {
        phase: "model",
        loaded: 0,
        total: 1,
        message: `${info.shortLabel} をダウンロード中（初回のみ・約${info.sizeMb}MB）…`,
        modelId,
      });
      const modelBuf = await fetchWithProgress(
        modelId,
        modelUrl,
        onProgress,
        info.shortLabel,
      );
      emit(onProgress, {
        phase: "init",
        loaded: 1,
        total: 1,
        message: `${info.shortLabel} ONNX 初期化中…`,
        modelId,
      });

      const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), {
        executionProviders: ["wasm"],
      });
      emit(onProgress, {
        phase: "ready",
        loaded: 1,
        total: 1,
        message: `${info.shortLabel} 準備完了`,
        modelId,
      });
      return session;
    })().catch((err) => {
      rt.sessionPromise = null;
      emit(onProgress, {
        phase: "error",
        loaded: 0,
        total: 0,
        message: err instanceof Error ? err.message : "モデル読み込み失敗",
        modelId,
      });
      throw err;
    });
  }
  return rt.sessionPromise;
}

/** WD v3: white-pad square, BGR NHWC 0–255 float */
async function imageToWdTensor(file: File): Promise<ort.Tensor> {
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

/** PixAI: stretch resize 448, RGB NCHW, normalize mean/std 0.5 */
async function imageToPixaiTensor(file: File): Promise<ort.Tensor> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = TARGET;
  canvas.height = TARGET;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, TARGET, TARGET);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, TARGET, TARGET);
  const float = new Float32Array(3 * TARGET * TARGET);
  const hw = TARGET * TARGET;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    float[p] = (data[i] / 255 - 0.5) / 0.5;
    float[hw + p] = (data[i + 1] / 255 - 0.5) / 0.5;
    float[2 * hw + p] = (data[i + 2] / 255 - 0.5) / 0.5;
  }
  return new ort.Tensor("float32", float, [1, 3, TARGET, TARGET]);
}

function pickOutput(
  session: ort.InferenceSession,
  output: Record<string, ort.Tensor>,
) {
  if (output.prediction) return output.prediction;
  return output[session.outputNames[0]];
}

async function runOneModel(
  file: File,
  modelId: BrowserModelId,
  opts: {
    threshold: number;
    characterThreshold: number;
    includeRating: boolean;
  },
  onProgress?: ProgressFn,
): Promise<TaggedByModel> {
  activeModelId = modelId;
  const family = BROWSER_MODELS[modelId].family;
  const [session, tags] = await Promise.all([
    loadSession(modelId, onProgress),
    loadTags(modelId, onProgress),
  ]);
  const input =
    family === "pixai"
      ? await imageToPixaiTensor(file)
      : await imageToWdTensor(file);
  const inputName =
    session.inputNames.includes("input") && family === "pixai"
      ? "input"
      : session.inputNames[0];
  const output = await session.run({ [inputName]: input });
  const out = pickOutput(session, output);
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
  return { modelId, tags: results };
}

export async function preloadWdBrowser(
  modelId: BrowserModelId,
  onProgress?: ProgressFn,
): Promise<void> {
  activeModelId = modelId;
  await loadTags(modelId, onProgress);
  await loadSession(modelId, onProgress);
}

export async function preloadBrowserModels(
  modelIds: BrowserModelId[],
  onProgress?: ProgressFn,
): Promise<void> {
  for (const id of modelIds) {
    await preloadWdBrowser(id, onProgress);
  }
}

export async function tagInBrowser(
  file: File,
  opts: {
    modelId: BrowserModelId;
    threshold: number;
    characterThreshold: number;
    includeRating: boolean;
  },
  onProgress?: ProgressFn,
): Promise<{ tags: TagScore[]; prompt: string; modelId: BrowserModelId }> {
  const one = await runOneModel(file, opts.modelId, opts, onProgress);
  const forced = forceUncensoredTags(one.tags);
  return {
    tags: forced,
    prompt: forced.map((t) => t.tag).join(", "),
    modelId: opts.modelId,
  };
}

/** Run several models and merge identical tags (max score, vote count). */
export async function tagEnsembleInBrowser(
  file: File,
  opts: {
    modelIds: BrowserModelId[];
    threshold: number;
    characterThreshold: number;
    includeRating: boolean;
  },
  onProgress?: ProgressFn,
): Promise<{
  tags: TagScore[];
  prompt: string;
  modelIds: BrowserModelId[];
  votes: Record<string, number>;
}> {
  const ids = [...new Set(opts.modelIds)];
  if (ids.length === 0) {
    throw new Error("結合するモデルが選択されていません");
  }
  if (ids.length === 1) {
    const single = await tagInBrowser(
      file,
      { ...opts, modelId: ids[0] },
      onProgress,
    );
    return {
      tags: single.tags,
      prompt: single.prompt,
      modelIds: [single.modelId],
      votes: Object.fromEntries(single.tags.map((t) => [t.tag, 1])),
    };
  }

  const parts: TaggedByModel[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    emit(onProgress, {
      phase: "model",
      loaded: i,
      total: ids.length,
      message: `結合推論 ${i + 1}/${ids.length}: ${BROWSER_MODELS[id].shortLabel}`,
      modelId: id,
    });
    parts.push(await runOneModel(file, id, opts, onProgress));
  }

  const merged = mergeTagScores(parts);
  const forced = forceUncensoredTags(mergedToTagScores(merged));
  const voteMap = Object.fromEntries(
    merged.map((t) => [t.tag.replaceAll("_", " "), t.votes]),
  );
  // Remap votes onto forced list keys
  const votes: Record<string, number> = {};
  for (const t of forced) {
    votes[t.tag] = voteMap[t.tag] ?? voteMap[t.tag.replaceAll(" ", "_")] ?? 1;
  }

  return {
    tags: forced,
    prompt: forced.map((t) => t.tag).join(", "),
    modelIds: ids,
    votes,
  };
}
