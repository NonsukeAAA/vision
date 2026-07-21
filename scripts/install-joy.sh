#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/services/api/.venv/bin/activate" 2>/dev/null || {
  python3 -m venv "$ROOT/services/api/.venv"
  # shellcheck disable=SC1091
  source "$ROOT/services/api/.venv/bin/activate"
  pip install -r "$ROOT/services/api/requirements.txt"
}
pip install -r "$ROOT/services/api/requirements-joy.txt"
echo "JoyCaption deps installed. First /tag call will download ${VISION_JOY_REPO:-fancyfeast/llama-joycaption-beta-one-hf-llava}"
