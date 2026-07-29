#!/bin/bash
# Double-clickable macOS helper (opens Terminal and stays resident).
cd "$(dirname "$0")" || exit 1

echo "vision helper を起動しています…"
echo ""

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 が見つかりません。"
  echo "https://www.python.org/downloads/ か brew install python で入れてください。"
  echo ""
  read -r -p "Enter で閉じる… "
  exit 1
fi

# Clear quarantine so first-run Gatekeeper prompts are less noisy for unsigned scripts.
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine . 2>/dev/null || true
fi

chmod +x helper_server.py VisionHelper.command 2>/dev/null || true
exec python3 helper_server.py
