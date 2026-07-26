import * as ort from "onnxruntime-web/wasm";
import type { TagScore } from "./types";
import { forceUncensoredTags } from "./forceUncensored";
import {
  BROWSER_MODELS,
  isAppleMobileUa,
  modelHfBase,
  modelOnnxUrl,
  type BrowserModelId,
} from "./browserModels";
import {
  mergeTagScores,
  mergedToTagScores,
  type TaggedByModel,
} from "./mergeTags";

const TARGET = 448;
const CACHE_PREFIX = "vision-tagger-v3";
/** Cache API only for small assets (tags CSV). ONNX goes to OPFS. */
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const OPFS_DIR = "vision-models-v4";

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

/** Free WASM sessions so a large model can initialize without OOM-killing the tab. */
export async function releaseBrowserSessions(
  except?: BrowserModelId,
): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const [id, rt] of runtimes) {
    if (except && id === except) continue;
    const pending = rt.sessionPromise;
    if (!pending) continue;
    rt.sessionPromise = null;
    jobs.push(
      (async () => {
        try {
          const session = await pending;
          await session.release();
        } catch {
          // ignore — session may have failed to load
        }
      })(),
    );
  }
  await Promise.all(jobs);
}

export function formatModelLoadError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "ダウンロードを中断しました";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return "モデル取得に失敗しました（通信エラー）。Wi‑Fi で再試行してください";
  }
  if (/QuotaExceeded|sqlite|cache/i.test(msg)) {
    return "端末ストレージ不足です。サイトデータを削除して再試行してください";
  }
  if (/out of memory|Array buffer|allocation/i.test(msg)) {
    return "メモリ不足です。他アプリを閉じて単体モデルで再試行してください";
  }
  return msg || "モデル読み込みに失敗しました";
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
  // ORT 1.27 only ships simd-threaded.wasm. Setting false skips the feature probe
  // (Safari sometimes reports no SIMD incorrectly) without changing the binary name.
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

async function cachePutBytes(
  id: BrowserModelId,
  url: string,
  data: Uint8Array,
  contentType: string,
): Promise<void> {
  if (data.byteLength > MAX_CACHE_BYTES) return;
  if (isAppleMobileUa()) return;
  try {
    const cache = await caches.open(cacheName(id));
    // Copy once into a detached ArrayBuffer owned by the Response.
    const copy = data.slice().buffer;
    await cache.put(
      url,
      new Response(copy, { headers: { "Content-Type": contentType } }),
    );
  } catch {
    // Quota / private mode — ignore
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

/**
 * Stream download into a single buffer (no chunk[] + merge double memory).
 */
async function fetchWithProgress(
  id: BrowserModelId,
  url: string,
  onProgress: ProgressFn | undefined,
  label: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const cached = await cacheMatch(id, url);
  throwIfAborted(signal);
  if (cached) {
    emit(onProgress, {
      phase: "model",
      loaded: 1,
      total: 1,
      message: `${label}（キャッシュ）`,
      modelId: id,
    });
    return new Uint8Array(await cached.arrayBuffer());
  }

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${label}の取得に失敗 (${res.status})`);

  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    void cachePutBytes(id, url, buf, "application/octet-stream");
    return buf;
  }

  const reader = res.body.getReader();

  if (total > 0) {
    let merged: Uint8Array;
    try {
      merged = new Uint8Array(total);
    } catch {
      throw new Error(
        `メモリ不足で ${label}（約${(total / 1e6).toFixed(0)}MB）を確保できません`,
      );
    }
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > total) {
        throw new Error(`${label} のサイズが予期より大きいです`);
      }
      merged.set(value, offset);
      offset += value.byteLength;
      emit(onProgress, {
        phase: "model",
        loaded: offset,
        total,
        message: `${label} ${Math.min(99, Math.round((offset / total) * 100))}%`,
        modelId: id,
      });
    }
    if (offset < total) {
      throw new Error(
        `${label} のダウンロードが途中で切れました（${(offset / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB）`,
      );
    }
    void cachePutBytes(id, url, merged, "application/octet-stream");
    return merged;
  }

  // Unknown length: grow geometrically (still better than keeping every chunk forever)
  let capacity = 1024 * 1024;
  let merged = new Uint8Array(capacity);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > capacity) {
      capacity = Math.max(capacity * 2, offset + value.byteLength);
      const next = new Uint8Array(capacity);
      next.set(merged.subarray(0, offset));
      merged = next;
    }
    merged.set(value, offset);
    offset += value.byteLength;
    emit(onProgress, {
      phase: "model",
      loaded: offset,
      total: offset,
      message: `${label} ${(offset / 1e6).toFixed(1)} MB`,
      modelId: id,
    });
  }
  const exact = merged.subarray(0, offset);
  void cachePutBytes(id, url, exact, "application/octet-stream");
  return exact;
}

function opfsSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

async function opfsModelsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

type OpfsModelMeta = {
  url: string;
  bytes: number;
  modelId: BrowserModelId;
  savedAt: number;
};

async function readOpfsCachedModel(
  id: BrowserModelId,
  url: string,
): Promise<File | null> {
  if (!opfsSupported()) return null;
  try {
    const dir = await opfsModelsDir();
    const metaFile = await (
      await dir.getFileHandle(`${id}.meta.json`)
    ).getFile();
    const meta = JSON.parse(await metaFile.text()) as OpfsModelMeta;
    if (meta.url !== url) return null;
    const onnx = await (await dir.getFileHandle(`${id}.onnx`)).getFile();
    if (meta.bytes > 0 && onnx.size !== meta.bytes) return null;
    if (onnx.size < 1_000_000) return null;
    return onnx;
  } catch {
    return null;
  }
}

async function writeOpfsMeta(
  dir: FileSystemDirectoryHandle,
  id: BrowserModelId,
  meta: OpfsModelMeta,
): Promise<void> {
  const handle = await dir.getFileHandle(`${id}.meta.json`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
}

/**
 * Load ONNX from OPFS when present; otherwise stream-download into OPFS.
 * Survives reloads — no need to re-download every visit.
 */
async function loadModelFilePersistent(
  id: BrowserModelId,
  url: string,
  onProgress: ProgressFn | undefined,
  label: string,
  signal?: AbortSignal,
): Promise<File> {
  const cached = await readOpfsCachedModel(id, url);
  throwIfAborted(signal);
  if (cached) {
    emit(onProgress, {
      phase: "model",
      loaded: 1,
      total: 1,
      message: `${label}（端末キャッシュ）`,
      modelId: id,
    });
    return cached;
  }

  const dir = await opfsModelsDir();
  const handle = await dir.getFileHandle(`${id}.onnx`, { create: true });

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${label}の取得に失敗 (${res.status})`);

  const total = Number(res.headers.get("content-length") || 0);
  const writable = await handle.createWritable();
  let loaded = 0;
  try {
    if (!res.body) {
      const buf = await res.arrayBuffer();
      await writable.write(buf);
      loaded = buf.byteLength;
    } else {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
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
    }
  } catch (err) {
    await writable.abort().catch(() => undefined);
    try {
      await dir.removeEntry(`${id}.onnx`);
    } catch {
      // ignore
    }
    throw err;
  }
  await writable.close();

  if (total > 0 && loaded < total) {
    try {
      await dir.removeEntry(`${id}.onnx`);
    } catch {
      // ignore
    }
    throw new Error(
      `${label} のダウンロードが途中で切れました（${(loaded / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB）`,
    );
  }

  await writeOpfsMeta(dir, id, {
    url,
    bytes: loaded,
    modelId: id,
    savedAt: Date.now(),
  });

  emit(onProgress, {
    phase: "model",
    loaded: 1,
    total: 1,
    message: `${label} を端末に保存しました`,
    modelId: id,
  });

  return (await dir.getFileHandle(`${id}.onnx`)).getFile();
}

async function createSessionFromBytesOrFile(
  source: Uint8Array | File,
  large: boolean,
  signal?: AbortSignal,
): Promise<ort.InferenceSession> {
  throwIfAborted(signal);
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    // Avoid heavy graph opts that spike RAM on top of the model copy.
    graphOptimizationLevel: large ? "disabled" : "basic",
    enableCpuMemArena: false,
    enableMemPattern: false,
  };

  if (source instanceof File) {
    const objectUrl = URL.createObjectURL(source);
    try {
      // ORT fetches the blob; our JS heap no longer holds a duplicate Uint8Array.
      return await ort.InferenceSession.create(objectUrl, options);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  return ort.InferenceSession.create(source, options);
}

async function loadSession(
  modelId: BrowserModelId,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<ort.InferenceSession> {
  const rt = getRuntime(modelId);
  if (!rt.sessionPromise) {
    rt.sessionPromise = (async () => {
      configureOrtWasm();
      const info = BROWSER_MODELS[modelId];
      const modelUrl = modelOnnxUrl(modelId);
      const large = info.sizeMb >= 300;
      // Prefer OPFS for all ONNX so reloads don't re-download (Cache API OOMs on large blobs).
      const useOpfs = opfsSupported();

      // Large ONNX needs ~2× size in memory (buffer + WASM heap). Evict others first.
      if (large || isAppleMobileUa()) {
        emit(onProgress, {
          phase: "init",
          loaded: 0,
          total: 1,
          message: "メモリ確保のため他モデルを解放中…",
          modelId,
        });
        await releaseBrowserSessions(modelId);
      }

      emit(onProgress, {
        phase: "model",
        loaded: 0,
        total: 1,
        message: `${info.shortLabel} を準備中（初回のみ約${info.sizeMb}MB取得）…`,
        modelId,
      });

      let source: Uint8Array | File;
      if (useOpfs) {
        source = await loadModelFilePersistent(
          modelId,
          modelUrl,
          onProgress,
          info.shortLabel,
          signal,
        );
      } else {
        source = await fetchWithProgress(
          modelId,
          modelUrl,
          onProgress,
          info.shortLabel,
          signal,
        );
      }
      throwIfAborted(signal);

      emit(onProgress, {
        phase: "init",
        loaded: 1,
        total: 1,
        message: large
          ? `${info.shortLabel} 初期化中（メモリを多く使います）…`
          : `${info.shortLabel} ONNX 初期化中…`,
        modelId,
      });

      // Let the progress UI paint before the blocking WASM alloc (often kills Safari).
      await new Promise<void>((r) => {
        requestAnimationFrame(() => setTimeout(r, 40));
      });
      throwIfAborted(signal);

      try {
        const session = await createSessionFromBytesOrFile(
          source,
          large,
          signal,
        );
        emit(onProgress, {
          phase: "ready",
          loaded: 1,
          total: 1,
          message: `${info.shortLabel} 準備完了`,
          modelId,
        });
        return session;
      } catch (err) {
        throw new Error(
          `${formatModelLoadError(err)}（${info.shortLabel}は ViT / ConvNeXt より重いです）`,
        );
      }
    })().catch((err) => {
      rt.sessionPromise = null;
      emit(onProgress, {
        phase: "error",
        loaded: 0,
        total: 0,
        message: formatModelLoadError(err),
        modelId,
      });
      throw err;
    });
  }

  const session = await rt.sessionPromise;
  throwIfAborted(signal);
  return session;
}

async function loadTags(
  modelId: BrowserModelId,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
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
      throwIfAborted(signal);
      if (cached) {
        text = await cached.text();
      } else {
        const res = await fetch(tagsUrl, { signal });
        if (!res.ok) throw new Error("タグ辞書の取得に失敗しました");
        text = await res.text();
        const encoded = new TextEncoder().encode(text);
        void cachePutBytes(modelId, tagsUrl, encoded, "text/csv");
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

  const tags = await rt.tagsPromise;
  throwIfAborted(signal);
  return tags;
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
  signal?: AbortSignal,
): Promise<TaggedByModel> {
  activeModelId = modelId;
  const family = BROWSER_MODELS[modelId].family;
  const info = BROWSER_MODELS[modelId];
  const [session, tags] = await Promise.all([
    loadSession(modelId, onProgress, signal),
    loadTags(modelId, onProgress, signal),
  ]);
  throwIfAborted(signal);
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

  // Large models: free WASM ASAP so the next ensemble member (or UI) has headroom.
  if (info.sizeMb >= 300 || isAppleMobileUa()) {
    await releaseBrowserSessions();
  }

  return { modelId, tags: results };
}

/** Warm tags CSV only (small). Full ONNX waits until analyze / explicit preload. */
export async function preloadBrowserTags(
  modelIds: BrowserModelId[],
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<void> {
  for (const id of modelIds) {
    throwIfAborted(signal);
    await loadTags(id, onProgress, signal);
  }
}

export async function preloadWdBrowser(
  modelId: BrowserModelId,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<void> {
  activeModelId = modelId;
  await loadTags(modelId, onProgress, signal);
  await loadSession(modelId, onProgress, signal);
}

export async function preloadBrowserModels(
  modelIds: BrowserModelId[],
  onProgress?: ProgressFn,
  signal?: AbortSignal,
): Promise<void> {
  for (const id of modelIds) {
    throwIfAborted(signal);
    await preloadWdBrowser(id, onProgress, signal);
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
  signal?: AbortSignal,
): Promise<{ tags: TagScore[]; prompt: string; modelId: BrowserModelId }> {
  const one = await runOneModel(file, opts.modelId, opts, onProgress, signal);
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
  signal?: AbortSignal,
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
      signal,
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
    throwIfAborted(signal);
    emit(onProgress, {
      phase: "model",
      loaded: i,
      total: ids.length,
      message: `結合推論 ${i + 1}/${ids.length}: ${BROWSER_MODELS[id].shortLabel}`,
      modelId: id,
    });
    parts.push(await runOneModel(file, id, opts, onProgress, signal));
  }

  const merged = mergeTagScores(parts);
  const forced = forceUncensoredTags(mergedToTagScores(merged));
  const voteMap = Object.fromEntries(
    merged.map((t) => [t.tag.replaceAll("_", " "), t.votes]),
  );
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
