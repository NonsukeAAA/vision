#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export VISION_MOCK_INFERENCE="${VISION_MOCK_INFERENCE:-1}"
export VISION_ENABLE_JOY="${VISION_ENABLE_JOY:-1}"
export VITE_BASE_PATH="${VITE_BASE_PATH:-/}"

if [[ ! -d "$ROOT/services/api/.venv" ]]; then
  python3 -m venv "$ROOT/services/api/.venv"
  # shellcheck disable=SC1091
  source "$ROOT/services/api/.venv/bin/activate"
  pip install -r "$ROOT/services/api/requirements.txt"
else
  # shellcheck disable=SC1091
  source "$ROOT/services/api/.venv/bin/activate"
fi

if [[ ! -d "$ROOT/apps/web/node_modules" ]]; then
  (cd "$ROOT/apps/web" && npm install)
fi

cleanup() {
  kill 0 2>/dev/null || true
}
trap cleanup EXIT

(cd "$ROOT/services/api" && uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) &
(cd "$ROOT/apps/web" && npm run dev -- --host 127.0.0.1 --port 5173) &

echo "vision API  http://127.0.0.1:8000/health"
echo "vision Web  http://127.0.0.1:5173/"
wait
