import * as ort from "onnxruntime-web";
import type { TagScore } from "./types";

const HF_BASE =
  "https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3/resolve/main";
const TARGET = 448;

type TagRow = { name: string; category: number };

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let tagsPromise: Promise<TagRow[]> | null = null;

async function loadTags(): Promise<TagRow[]> {
  if (!tagsPromise) {
    tagsPromise = (async () => {
      const res = await fetch(`${HF_BASE}/selected_tags.csv`);
      if (!res.ok) throw new Error("Failed to download WD tags CSV");
      const text = await res.text();
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
    })();
  }
  return tagsPromise;
}

async function loadSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      ort.env.wasm.wasmPaths =
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";
      return ort.InferenceSession.create(`${HF_BASE}/model.onnx`, {
        executionProviders: ["wasm"],
      });
    })();
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
  // BGR float32 NHWC
  const float = new Float32Array(TARGET * TARGET * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    float[j] = data[i + 2];
    float[j + 1] = data[i + 1];
    float[j + 2] = data[i];
  }
  return new ort.Tensor("float32", float, [1, TARGET, TARGET, 3]);
}

export async function preloadWdBrowser(): Promise<void> {
  await Promise.all([loadSession(), loadTags()]);
}

export async function tagInBrowser(
  file: File,
  opts: {
    threshold: number;
    characterThreshold: number;
    includeRating: boolean;
  },
): Promise<{ tags: TagScore[]; prompt: string }> {
  const [session, tags] = await Promise.all([loadSession(), loadTags()]);
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
  const prompt = results.map((t) => t.tag).join(", ");
  return { tags: results, prompt };
}
