#!/usr/bin/env node
/**
 * Ensure Pages dist includes the PixAI INT8 ONNX (~308MB).
 * Prefers a local quantized file, otherwise downloads from the live Pages URL
 * (so subsequent deploys don't need to re-quantize from FP32).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const destDir = join(webRoot, "dist", "models");
const dest = join(destDir, "pixai-v09-int8.onnx");
const candidates = [
  process.env.PIXAI_INT8_ONNX,
  "/tmp/pixai-quant/model-int8.onnx",
  join(webRoot, "public", "models", "pixai-v09-int8.onnx"),
].filter(Boolean);

mkdirSync(destDir, { recursive: true });

const local = candidates.find((p) => p && existsSync(p));
if (local) {
  console.log(`[copy-pixai-int8] copying ${local} -> ${dest}`);
  copyFileSync(local, dest);
  process.exit(0);
}

const remote =
  process.env.PIXAI_INT8_URL ||
  "https://nonsukeaaa.github.io/vision/models/pixai-v09-int8.onnx";

console.log(`[copy-pixai-int8] fetching ${remote}`);
const res = await fetch(remote);
if (!res.ok) {
  console.error(
    `[copy-pixai-int8] missing local INT8 and remote fetch failed (${res.status}).`,
  );
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
const { writeFileSync } = await import("node:fs");
writeFileSync(dest, buf);
console.log(`[copy-pixai-int8] wrote ${dest} (${(buf.length / 1e6).toFixed(1)} MB)`);
