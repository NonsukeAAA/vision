/**
 * Pack Windows + macOS resident helpers into public/helper for Pages download.
 */
import { cpSync, mkdirSync, rmSync, existsSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const repoRoot = join(webRoot, "..", "..");
const apiSrc = join(repoRoot, "services", "api");
const outDir = join(webRoot, "public", "helper");

function copyApi(apiDest) {
  mkdirSync(apiDest, { recursive: true });
  cpSync(join(apiSrc, "app"), join(apiDest, "app"), { recursive: true });
  cpSync(join(apiSrc, "requirements.txt"), join(apiDest, "requirements.txt"));
  cpSync(join(apiSrc, "requirements-joy.txt"), join(apiDest, "requirements-joy.txt"));
  cpSync(join(apiSrc, "Dockerfile"), join(apiDest, "Dockerfile"));
  rmSync(join(apiDest, "app", "__pycache__"), { recursive: true, force: true });
}

function zipStage(stage, zipPath) {
  rmSync(zipPath, { force: true });
  try {
    execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: stage, stdio: "inherit" });
  } catch {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: "inherit" },
    );
  }
  if (!existsSync(zipPath)) {
    throw new Error(`zip was not created: ${zipPath}`);
  }
  console.log(`[pack-helper] wrote ${zipPath}`);
}

function packWindows() {
  const helperSrc = join(repoRoot, "apps", "helper-windows");
  const stage = join(outDir, "_stage_win");
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
  copyApi(join(stage, "api"));
  zipStage(stage, zipPath);
  rmSync(stage, { recursive: true, force: true });
}

function packMac() {
  const helperSrc = join(repoRoot, "apps", "helper-macos");
  const stage = join(outDir, "_stage_mac");
  const zipPath = join(outDir, "vision-helper-macos.zip");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const name of [
    "VisionHelper.command",
    "helper_server.py",
    "README.txt",
    "models.json",
    "docker-compose.yml",
  ]) {
    cpSync(join(helperSrc, name), join(stage, name));
  }
  // Ensure the .command is executable inside the zip metadata when possible.
  try {
    chmodSync(join(stage, "VisionHelper.command"), 0o755);
    chmodSync(join(stage, "helper_server.py"), 0o755);
  } catch {
    // Windows pack hosts may ignore mode bits.
  }
  copyApi(join(stage, "api"));
  zipStage(stage, zipPath);
  rmSync(stage, { recursive: true, force: true });
}

mkdirSync(outDir, { recursive: true });
packWindows();
packMac();
