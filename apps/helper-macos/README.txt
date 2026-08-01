vision helper (macOS)
=====================

GitHub Pages の vision 設定から JoyCaption API を起動する常駐ヘルパーです。

準備
----
- python3（必須 · ヘルパー本体）
- Docker Desktop（推奨）または Python で API を直接起動

使い方
----
1. VisionHelper.command をダブルクリック
   （「開発元を確認できません」→ 右クリック → 開く）
2. ターミナルの窓は閉じない
3. ブラウザの vision 設定でモデルを選び「JoyCaption を起動」
4. 初回はモデル取得に数分〜数十分かかることがあります

止める
----
vision 設定の「API を停止」、またはこのターミナルを閉じる

ポート
----
ヘルパー制御: http://127.0.0.1:8765
JoyCaption API: http://127.0.0.1:8000/health
