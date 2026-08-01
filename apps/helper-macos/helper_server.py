#!/usr/bin/env python3
"""vision helper control plane for macOS (and any Unix with Python 3).

Listens on http://127.0.0.1:8765  — same contract as the Windows PowerShell helper.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HELPER_PORT = 8765
API_BASE = "http://127.0.0.1:8000"
STATE_FILE = ROOT / "helper-state.json"
LOG_FILE = ROOT / "helper.log"
COMPOSE_FILE = ROOT / "docker-compose.yml"
MODELS_FILE = ROOT / "models.json"
API_DIR = ROOT / "api"


def log(msg: str) -> None:
    line = time.strftime("[%Y-%m-%d %H:%M:%S] ") + msg
    print(line, flush=True)
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_models() -> list[dict]:
    if not MODELS_FILE.exists():
        return []
    return json.loads(MODELS_FILE.read_text(encoding="utf-8"))


def resolve_joy_repo(model_id: str) -> str:
    models = load_models()
    for m in models:
        if m.get("id") == model_id:
            return str(m["repo"])
    if models:
        return str(models[0]["repo"])
    return "fancyfeast/llama-joycaption-beta-one-hf-llava"


def read_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"backend": "none", "running": False, "joyRepo": "", "pid": None}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def have_docker() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        r = subprocess.run(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def have_python() -> str | None:
    for cmd in ("python3", "python"):
        path = shutil.which(cmd)
        if path:
            return path
    return None


def api_health() -> dict | None:
    try:
        with urllib.request.urlopen(f"{API_BASE}/health", timeout=2) as res:
            return json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def stop_api() -> None:
    state = read_state()
    if state.get("backend") == "docker" and COMPOSE_FILE.exists():
        log("docker compose down")
        subprocess.run(
            ["docker", "compose", "-f", str(COMPOSE_FILE), "down"],
            cwd=str(ROOT),
            check=False,
        )
    pid = state.get("pid")
    if state.get("backend") == "python" and pid:
        try:
            os.kill(int(pid), signal.SIGTERM)
        except (OSError, ValueError):
            pass
    # Free :8000 if something is still bound
    try:
        r = subprocess.run(["lsof", "-ti", "tcp:8000"], capture_output=True, text=True)
        for line in r.stdout.split():
            try:
                os.kill(int(line.strip()), signal.SIGTERM)
            except (OSError, ValueError):
                pass
    except OSError:
        pass
    save_state({"backend": "none", "running": False, "joyRepo": "", "pid": None})


def start_api_docker(joy_repo: str, enable_joy: bool) -> None:
    env = os.environ.copy()
    env["VISION_JOY_REPO"] = joy_repo
    env["VISION_ENABLE_JOY"] = "1" if enable_joy else "0"
    env["VISION_MOCK_INFERENCE"] = "0"
    log(f"docker compose up (repo={joy_repo} joy={enable_joy})")
    r = subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d", "--build"],
        cwd=str(ROOT),
        env=env,
    )
    if r.returncode != 0:
        raise RuntimeError(f"docker compose up failed ({r.returncode})")
    save_state({"backend": "docker", "running": True, "joyRepo": joy_repo, "pid": None})


def start_api_python(joy_repo: str, enable_joy: bool) -> None:
    py = have_python()
    if not py:
        raise RuntimeError("python3 が見つかりません。Docker Desktop か Python 3.12+ を入れてください")
    if not API_DIR.exists():
        raise RuntimeError("api/ フォルダがありません。ZIP を正しく解凍してください")
    venv = API_DIR / ".venv"
    if not venv.exists():
        log("creating venv…")
        subprocess.run([py, "-m", "venv", str(venv)], check=True)
    pip = venv / "bin" / "pip"
    python = venv / "bin" / "python"
    log("installing API requirements…")
    subprocess.run([str(pip), "install", "-r", str(API_DIR / "requirements.txt")], check=True)
    if enable_joy:
        subprocess.run(
            [str(pip), "install", "-r", str(API_DIR / "requirements-joy.txt")],
            check=True,
        )
    env = os.environ.copy()
    env.update(
        {
            "VISION_JOY_REPO": joy_repo,
            "VISION_ENABLE_JOY": "1" if enable_joy else "0",
            "VISION_MOCK_INFERENCE": "0",
            "VISION_HOST": "127.0.0.1",
            "VISION_PORT": "8000",
            "VISION_CORS_ORIGINS": "*",
        }
    )
    log("starting uvicorn…")
    proc = subprocess.Popen(
        [str(python), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=str(API_DIR),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    save_state(
        {"backend": "python", "running": True, "joyRepo": joy_repo, "pid": proc.pid}
    )


def wait_api_ready(seconds: int = 240) -> dict | None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        h = api_health()
        if h and h.get("status") == "ok":
            return h
        time.sleep(2)
    return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quieter
        log("http " + (fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path not in ("/", "/status"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        state = read_state()
        health = api_health()
        joy_repo = ""
        if health and isinstance(health.get("models"), dict):
            joy_repo = str(health["models"].get("joy") or "")
        if not joy_repo:
            joy_repo = str(state.get("joyRepo") or "")
        self._json(
            200,
            {
                "ok": True,
                "running": bool(state.get("running")),
                "apiReady": bool(health and health.get("status") == "ok"),
                "joyReady": bool(health and health.get("joy_ready")),
                "joyAvailable": bool(health and health.get("joy_available")),
                "joyRepo": joy_repo,
                "backend": state.get("backend") or "none",
                "message": (
                    "API 接続OK"
                    if health
                    else ("API 起動中…" if state.get("running") else "待機中")
                ),
                "docker": have_docker(),
                "python": bool(have_python()),
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            parsed = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            parsed = {}

        try:
            if path == "/start":
                model_id = str(parsed.get("joyModelId") or "beta-one")
                enable_joy = bool(parsed.get("enableJoy", True))
                repo = resolve_joy_repo(model_id)
                stop_api()
                if have_docker():
                    start_api_docker(repo, enable_joy)
                    backend = "docker"
                else:
                    start_api_python(repo, enable_joy)
                    backend = "python"
                health = wait_api_ready(240)
                self._json(
                    200 if health else 202,
                    {
                        "ok": bool(health),
                        "running": True,
                        "apiReady": bool(health),
                        "joyReady": bool(health and health.get("joy_ready")),
                        "joyAvailable": bool(health and health.get("joy_available")),
                        "joyRepo": repo,
                        "backend": backend,
                        "message": (
                            "JoyCaption API を起動しました"
                            if health
                            else "起動コマンドは送りましたが /health がまだ応答しません。初回はモデル取得に時間がかかります"
                        ),
                    },
                )
                return
            if path == "/stop":
                stop_api()
                self._json(
                    200,
                    {
                        "ok": True,
                        "running": False,
                        "apiReady": False,
                        "backend": "none",
                        "message": "停止しました",
                    },
                )
                return
            self._json(404, {"ok": False, "error": "not found"})
        except Exception as err:  # noqa: BLE001
            log(f"error: {err}")
            self._json(
                500,
                {
                    "ok": False,
                    "error": str(err),
                    "running": False,
                    "apiReady": False,
                },
            )


def main() -> int:
    os.chdir(ROOT)
    log(f"vision helper starting on 127.0.0.1:{HELPER_PORT}")
    print()
    print("  vision helper  (常駐 · macOS)")
    print(f"  制御: http://127.0.0.1:{HELPER_PORT}/status")
    print(f"  API : {API_BASE}/health")
    print("  この窓を閉じるとヘルパーが止まります。")
    print("  vision の設定から「JoyCaption を起動」を押してください。")
    print()
    server = ThreadingHTTPServer(("127.0.0.1", HELPER_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping…")
        stop_api()
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
