#!/usr/bin/env node
/**
 * Ensure Pages dist includes PixAI 4-bit split parts (<100MB each for GitHub).
 * Prefers /tmp/pixai-quant/parts-q4, else mirrors from the live site.
 *
 * 4-bit MatMulNBits (block_size=32) is what fits mobile Safari: FP16 is re-expanded
 * to fp32 by the WASM CPU EP, and dynamic INT8 wrecks the MLP weights.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const destDir = join(webRoot, "dist", "models");
const localPartsDir =
  process.env.PIXAI_Q4_PARTS_DIR || "/tmp/pixai-quant/parts-q4";
const remoteBase =
  process.env.PIXAI_Q4_BASE || "https://nonsukeaaa.github.io/vision/models";
const PREFIX = "pixai-v09-q4";

mkdirSync(destDir, { recursive: true });

function copyLocalParts() {
  if (!existsSync(localPartsDir)) return false;
  const files = readdirSync(localPartsDir).filter((f) => f.startsWith(PREFIX));
  if (!files.includes(`${PREFIX}.json`)) return false;
  for (const f of files) {
    copyFileSync(join(localPartsDir, f), join(destDir, f));
  }
  console.log(
    `[copy-pixai-q4] copied ${files.length} files from ${localPartsDir}`,
  );
  return true;
}

async function mirrorRemote() {
  const manifestUrl = `${remoteBase}/${PREFIX}.json`;
  console.log(`[copy-pixai-q4] fetching manifest ${manifestUrl}`);
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    throw new Error(`manifest fetch failed (${res.status})`);
  }
  const manifest = await res.json();
  writeFileSync(join(destDir, `${PREFIX}.json`), JSON.stringify(manifest));
  for (const part of manifest.parts) {
    const url = `${remoteBase}/${part.name}`;
    console.log(`[copy-pixai-q4] fetching ${url}`);
    const partRes = await fetch(url);
    if (!partRes.ok) {
      throw new Error(`${part.name} fetch failed (${partRes.status})`);
    }
    const buf = Buffer.from(await partRes.arrayBuffer());
    writeFileSync(join(destDir, part.name), buf);
  }
  console.log(`[copy-pixai-q4] mirrored ${manifest.parts.length} parts`);
}

if (!copyLocalParts()) {
  try {
    await mirrorRemote();
  } catch (err) {
    console.error("[copy-pixai-q4]", err);
    process.exit(1);
  }
}
