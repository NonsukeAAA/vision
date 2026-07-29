/**
 * Pack the Windows resident helper into public/helper for Pages download.
 * Copies a snapshot of services/api (no venv / caches) beside the scripts.
 */
import { cpSync, mkdirSync, rmSync, existsSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const repoRoot = join(webRoot, "..", "..");
const helperSrc = join(repoRoot, "apps", "helper-windows");
const apiSrc = join(repoRoot, "services", "api");
const outDir = join(webRoot, "public", "helper");
const stage = join(outDir, "_stage");
const zipPath = join(outDir, "vision-helper-windows.zip");

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const name of [
  "VisionHelper.bat",
  "VisionHelper.ps1",
  "README.txt",
  "models.json",
  "docker-compose.yml",
]) {
  cpSync(join(helperSrc, name), join(stage, name));
}

const apiDest = join(stage, "api");
mkdirSync(apiDest, { recursive: true });
cpSync(join(apiSrc, "app"), join(apiDest, "app"), { recursive: true });
cpSync(join(apiSrc, "requirements.txt"), join(apiDest, "requirements.txt"));
cpSync(join(apiSrc, "requirements-joy.txt"), join(apiDest, "requirements-joy.txt"));
cpSync(join(apiSrc, "Dockerfile"), join(apiDest, "Dockerfile"));
// Drop bytecode if any slipped in
rmSync(join(apiDest, "app", "__pycache__"), { recursive: true, force: true });

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

function zipWithSystem() {
  try {
    execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: stage, stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

if (!zipWithSystem()) {
  // Fallback: write a crude store-only zip via PowerShell if present, else fail clearly.
  try {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } catch (err) {
    console.error("[pack-helper] zip tools unavailable:", err);
    process.exit(1);
  }
}

rmSync(stage, { recursive: true, force: true });
if (!existsSync(zipPath)) {
  console.error("[pack-helper] zip was not created");
  process.exit(1);
}
console.log(`[pack-helper] wrote ${zipPath}`);
