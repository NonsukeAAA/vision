# vision

端末ローカルで動く Stable Diffusion タグジェネレータ Web アプリです。  
画像を Danbooru 形式タグ / 詳細キャプションへ変換します。

## 特徴

- **Material 3 Expressive** — ルートの [`DESIGN.md`](./DESIGN.md)（[Google Labs DESIGN.md 仕様](https://github.com/google-labs-code/design.md)）に準拠。UI は [`@m3e/react`](https://github.com/matraic/m3e) で実装（公式 Material Web は Expressive 非対応のため）
- **ローカル推論** — 画像は外部 API に送りません
- **モデル**
  - [JoyCaption Beta One](https://huggingface.co/fancyfeast/llama-joycaption-beta-one-hf-llava) — 情景・表情に強い詳細キャプション（ローカル API）
  - [WD EVA02-Large Tagger v3](https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3) — Danbooru タグ（ブラウザ ONNX / ローカル API）

## GitHub Pages デプロイ

静的フロント（ブラウザ内 WD14）を Pages に公開できます。

1. このリポジトリを GitHub に push
2. **Settings → Pages → Build and deployment** で Source を **GitHub Actions** に設定
3. [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) が `main`（または本ブランチ）への push でビルド・デプロイ
4. 公開 URL: `https://<user>.github.io/<repo>/`  
   （`VITE_BASE_PATH` はワークフローがリポジトリ名から自動設定）

Pages 上の既定エンジンは **ブラウザ (WD14)** です。JoyCaption 併用はローカル API を起動し、設定で `local-api` に切り替えてください（ブラウザから `http://127.0.0.1:8000` へ接続。CORS 許可済み）。

## ローカル開発

```bash
chmod +x scripts/*.sh
./scripts/dev.sh
```

- Web: http://127.0.0.1:5173/
- API: http://127.0.0.1:8000/health

既定では API は `VISION_MOCK_INFERENCE=1`（モック）です。実モデル:

```bash
# WD14 のみ（ONNX）
VISION_MOCK_INFERENCE=0 ./scripts/dev.sh

# JoyCaption も使う場合
./scripts/install-joy.sh
VISION_MOCK_INFERENCE=0 VISION_ENABLE_JOY=1 ./scripts/dev.sh
```

初回は Hugging Face からモデルを取得します（JoyCaption は数 GB）。

### フロントのみ

```bash
cd apps/web
npm install
VITE_BASE_PATH=/ npm run dev
```

### API のみ

```bash
cd services/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
VISION_MOCK_INFERENCE=1 uvicorn app.main:app --reload --port 8000
```

### テスト

```bash
cd services/api && source .venv/bin/activate
VISION_MOCK_INFERENCE=1 pytest
cd ../../apps/web && npm run build
```

## 出力モード

| モード | 内容 |
|--------|------|
| Booru | WD14 タグ（閾値調整可） |
| Caption | JoyCaption 詳細キャプション（表情・情景重視） |
| Hybrid | キャプション + タグ結合プロンプト |

## ディレクトリ

```
DESIGN.md                 # M3 Expressive デザイン規範
apps/web/                 # Vite + React + @m3e
services/api/             # FastAPI (JoyCaption + WD14)
.github/workflows/        # GitHub Pages デプロイ
scripts/dev.sh
```

## ライセンス

アプリコードは MIT を想定。利用モデルは各 Hugging Face カードのライセンスに従ってください。
