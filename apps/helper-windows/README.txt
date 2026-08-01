vision helper (Windows)
=======================

GitHub Pages の vision 設定から JoyCaption API を起動するための常駐ヘルパーです。

準備
----
次のどちらかが必要です。

1. Docker Desktop（推奨・ワンクリックに近い）
   https://www.docker.com/products/docker-desktop/
2. または Python 3.12 以上（PATH に python / py）

使い方
----
1. VisionHelper.bat をダブルクリック（この窓は開いたまま）
2. ブラウザで vision を開き、設定 → JoyCaption モデルを選び「JoyCaption を起動」
3. 初回はモデル取得で数分〜数十分かかることがあります（数 GB）
4. 終わったら設定のエンジンが「ローカル API」になり、Caption / Hybrid が使えます

止める
----
vision 設定の「API を停止」、またはこの窓を閉じる

ポート
----
ヘルパー制御: http://127.0.0.1:8765
JoyCaption API: http://127.0.0.1:8000/health

GPU
----
NVIDIA + Docker の場合、docker-compose.yml 内の GPU コメントを外すと速くなります。
CPU でも動きますが JoyCaption はかなり遅いです。
