#!/usr/bin/env node
/**
 * Ensure Pages dist includes PixAI INT8 split parts (<100MB each for GitHub).
 * Prefers /tmp/pixai-quant/parts, else mirrors from the live site.
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
const localPartsDir = "/tmp/pixai-quant/parts";
const remoteBase =
  process.env.PIXAI_INT8_BASE ||
  "https://nonsukeaaa.github.io/vision/models";

mkdirSync(destDir, { recursive: true });

function copyLocalParts() {
  if (!existsSync(localPartsDir)) return false;
  const files = readdirSync(localPartsDir).filter(
    (f) => f.startsWith("pixai-v09-int8"),
  );
  if (!files.includes("pixai-v09-int8.json")) return false;
  for (const f of files) {
    copyFileSync(join(localPartsDir, f), join(destDir, f));
  }
  console.log(`[copy-pixai-int8] copied ${files.length} files from ${localPartsDir}`);
  return true;
}

async function mirrorRemote() {
  const manifestUrl = `${remoteBase}/pixai-v09-int8.json`;
  console.log(`[copy-pixai-int8] fetching manifest ${manifestUrl}`);
  const res = await fetch(manifestUrl);
  if (!res.ok) {
    throw new Error(`manifest fetch failed (${res.status})`);
  }
  const manifest = await res.json();
  writeFileSync(join(destDir, "pixai-v09-int8.json"), JSON.stringify(manifest));
  for (const part of manifest.parts) {
    const url = `${remoteBase}/${part.name}`;
    console.log(`[copy-pixai-int8] fetching ${url}`);
    const partRes = await fetch(url);
    if (!partRes.ok) throw new Error(`${part.name} fetch failed (${partRes.status})`);
    const buf = Buffer.from(await partRes.arrayBuffer());
    writeFileSync(join(destDir, part.name), buf);
  }
  console.log(`[copy-pixai-int8] mirrored ${manifest.parts.length} parts`);
}

if (!copyLocalParts()) {
  try {
    await mirrorRemote();
  } catch (err) {
    console.error("[copy-pixai-int8]", err);
    process.exit(1);
  }
}
