import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eLoadingIndicator } from "@m3e/react/loading-indicator";
import { M3eSegmentedButton } from "@m3e/react/segmented-button";
import { M3eButtonSegment } from "@m3e/react/segmented-button";
import { M3eSlider } from "@m3e/react/slider";
import { M3eSliderThumb } from "@m3e/react/slider";
import { M3eTheme } from "@m3e/react/theme";
import { checkHealth, tagViaApi } from "./api";
import {
  isGitHubPagesHost,
  loadSettings,
  saveSettings,
  type AppSettings,
  type OutputMode,
  type TagResult,
  type TagScore,
} from "./types";
import { preloadWdBrowser, tagInBrowser } from "./wdBrowser";

type Screen = "home" | "working" | "result";

async function ensureBrowserReady(): Promise<string> {
  await preloadWdBrowser();
  return "ブラウザ内 WD EVA02 準備完了（端末ローカル推論）";
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [screen, setScreen] = useState<Screen>("home");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<TagResult | null>(null);
  const [editableTags, setEditableTags] = useState<TagScore[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [apiStatus, setApiStatus] = useState<string>("モデル準備中…");
  const [modelReady, setModelReady] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const onPages = isGitHubPagesHost();

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (settings.engine === "browser") {
        try {
          const msg = await ensureBrowserReady();
          if (!cancelled) {
            setModelReady(true);
            setApiStatus(msg);
          }
        } catch (err) {
          if (!cancelled) {
            setModelReady(false);
            setApiStatus(
              err instanceof Error ? err.message : "モデル読み込み失敗",
            );
          }
        }
        return;
      }

      const health = await checkHealth(settings.apiBase);
      if (cancelled) return;

      if (health.ok) {
        setModelReady(true);
        setApiStatus(
          `ローカル API 接続OK${health.mock ? " (mock)" : ""}${health.joy_available ? " · JoyCaption可" : " · JoyCaption未導入"}`,
        );
        return;
      }

      // API 不通時はブラウザ推論へ自動フォールバック（Pages でも解析可能にする）
      try {
        const msg = await ensureBrowserReady();
        if (cancelled) return;
        setSettings((s) => ({ ...s, engine: "browser" }));
        setModelReady(true);
        setApiStatus(
          `API 未接続のためブラウザ推論に切替 · ${msg}`,
        );
        setSnack("ローカル API に接続できないため、ブラウザ内 WD14 に切り替えました");
      } catch (err) {
        if (cancelled) return;
        setModelReady(false);
        setApiStatus(
          `API 未接続: ${health.detail ?? "error"} / ブラウザ推論も失敗`,
        );
        setError(
          err instanceof Error
            ? err.message
            : "推論エンジンを初期化できませんでした",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.engine, settings.apiBase]);

  useEffect(() => {
    if (!snack) return;
    const t = window.setTimeout(() => setSnack(null), 2200);
    return () => window.clearTimeout(t);
  }, [snack]);

  const pickFile = (next: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
    setResult(null);
    setEditableTags([]);
    setPrompt("");
    setError(null);
    if (next) startTransition(() => setScreen("home"));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) pickFile(f);
  };

  const runTag = async () => {
    if (!file) return;
    setError(null);
    setScreen("working");
    try {
      let next: TagResult;
      if (settings.engine === "local-api") {
        next = await tagViaApi(file, settings);
      } else {
        if (settings.mode === "caption") {
          throw new Error(
            "詳細キャプション（JoyCaption）はローカル API モードが必要です。設定で engine を local-api に切り替えてください。",
          );
        }
        const browser = await tagInBrowser(file, {
          threshold: settings.threshold,
          characterThreshold: settings.characterThreshold,
          includeRating: settings.includeRating,
        });
        next = {
          mode: settings.mode === "hybrid" ? "booru" : settings.mode,
          tags: browser.tags,
          prompt: browser.prompt,
          caption: null,
          source: { wd: "browser-onnx" },
          device: "wasm",
          mock: false,
        };
        if (settings.mode === "hybrid") {
          next.prompt = browser.prompt;
          next.source.note =
            "GitHub Pages / ブラウザモードでは WD14 タグのみ。JoyCaption 併用はローカル API を起動してください。";
        }
      }
      setResult(next);
      setEditableTags(next.tags);
      setPrompt(next.prompt);
      setScreen("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析に失敗しました");
      setScreen("home");
    }
  };

  const rebuildPrompt = (tags: TagScore[], caption: string | null, mode: OutputMode) => {
    const tagPart = tags.map((t) => t.tag).join(", ");
    if (mode === "caption") return caption ?? "";
    if (mode === "hybrid" && caption) return `${caption}\n\n${tagPart}`;
    return tagPart;
  };

  const removeTag = (tag: string) => {
    const tags = editableTags.filter((t) => t.tag !== tag);
    setEditableTags(tags);
    setPrompt(rebuildPrompt(tags, result?.caption ?? null, settings.mode));
  };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setSnack("プロンプトをコピーしました");
  };

  const thresholdPercent = useMemo(
    () => Math.round(settings.threshold * 100),
    [settings.threshold],
  );

  return (
    <M3eTheme color="#386A20" variant="tonal-spot" scheme="light" motion="expressive">
      <div className="app-shell">
        <div className="toolbar">
          <span className="muted">{apiStatus || "準備中…"}</span>
          <M3eButton
            variant="text"
            onClick={() => setShowSettings((v) => !v)}
          >
            設定
          </M3eButton>
        </div>

        {showSettings && (
          <div className="settings" style={{ marginBottom: "var(--space-lg)" }}>
            <p className="section-title">設定</p>
            {onPages && (
              <p className="muted">
                GitHub Pages では画像を端末内（ブラウザ）で解析します。JoyCaption
                併用は PC で API を起動し、下のエンジンを「ローカル API」にしてください。
              </p>
            )}
            <label>
              推論エンジン
              <select
                value={settings.engine}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    engine: e.target.value as AppSettings["engine"],
                  }))
                }
              >
                <option value="browser">ブラウザ (WD14 · 推奨 / Pages対応)</option>
                <option value="local-api">ローカル API (JoyCaption + WD14)</option>
              </select>
            </label>
            {settings.engine === "local-api" && (
              <>
                <p className="muted">
                  事前に <code>./scripts/dev.sh</code> などで API
                  を起動してください。未起動の場合は自動でブラウザ推論に戻ります。
                </p>
                <label>
                  API Base URL
                  <input
                    type="text"
                    value={settings.apiBase}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, apiBase: e.target.value }))
                    }
                  />
                </label>
              </>
            )}
            <label>
              一般タグ閾値 ({thresholdPercent}%)
              <M3eSlider
                min={0.05}
                max={0.95}
                step={0.05}
                labelled
                onChange={(e) => {
                  const target = e.target as HTMLElement & { value?: number | null };
                  const thumb = (e.target as HTMLElement).querySelector?.(
                    "m3e-slider-thumb",
                  ) as (HTMLElement & { value: number | null }) | null;
                  const v = Number(thumb?.value ?? target.value);
                  if (!Number.isNaN(v)) {
                    setSettings((s) => ({ ...s, threshold: v }));
                  }
                }}
              >
                <M3eSliderThumb value={settings.threshold} />
              </M3eSlider>
            </label>
            <label>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={settings.includeRating}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      includeRating: e.target.checked,
                    }))
                  }
                />
                rating タグを含める
              </span>
            </label>
            {settings.engine === "local-api" && (
              <label>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={settings.enableJoy}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        enableJoy: e.target.checked,
                      }))
                    }
                  />
                  JoyCaption を使う
                </span>
              </label>
            )}
          </div>
        )}

        <header className="brand">
          <h1>vision</h1>
          <p>画像を Stable Diffusion タグへ。端末ローカルで解析します。</p>
        </header>

        <div className="stack">
          <M3eSegmentedButton>
            {(
              [
                ["booru", "Booru"],
                ["caption", "Caption"],
                ["hybrid", "Hybrid"],
              ] as const
            ).map(([value, label]) => (
              <M3eButtonSegment
                key={value}
                value={value}
                checked={settings.mode === value}
                onChange={() => setSettings((s) => ({ ...s, mode: value }))}
                onClick={() => setSettings((s) => ({ ...s, mode: value }))}
              >
                {label}
              </M3eButtonSegment>
            ))}
          </M3eSegmentedButton>

          <div
            className={`dropzone ${dragging ? "dragging" : ""}`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            {previewUrl ? (
              <img className="preview" src={previewUrl} alt="選択中の画像" />
            ) : (
              <>
                <strong>画像をドロップ</strong>
                <span className="muted">またはクリックして選択 · PNG / JPEG / WebP</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="row">
            <M3eButton
              variant="filled"
              disabled={!file || screen === "working" || !modelReady}
              onClick={() => void runTag()}
            >
              解析する
            </M3eButton>
            {file && (
              <M3eButton variant="text" onClick={() => pickFile(null)}>
                クリア
              </M3eButton>
            )}
          </div>

          {screen === "working" && (
            <div className="status-line panel">
              <M3eLoadingIndicator />
              <span>情景とタグを読み取っています…</span>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {screen === "result" && result && (
            <section className="panel stack">
              <h2 className="section-title">結果</h2>
              <p className="muted">
                device: {result.device}
                {result.source.wd ? ` · wd: ${result.source.wd}` : ""}
                {result.source.joy ? ` · joy: ${result.source.joy}` : ""}
              </p>
              {result.source.note && <p className="muted">{result.source.note}</p>}

              {editableTags.length > 0 && (
                <div className="chip-wrap">
                  {editableTags.map((t) => (
                    <button
                      key={t.tag}
                      type="button"
                      className="tag-chip"
                      onClick={() => removeTag(t.tag)}
                      title="クリックで削除"
                    >
                      {t.tag}
                      <span className="score">{t.score.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              )}

              <textarea
                className="prompt-box"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                aria-label="生成プロンプト"
              />

              <div className="row">
                <M3eButton variant="filled" onClick={() => void copyPrompt()}>
                  コピー
                </M3eButton>
                <M3eButton
                  variant="tonal"
                  onClick={() => {
                    setScreen("home");
                  }}
                >
                  戻る
                </M3eButton>
              </div>
            </section>
          )}
        </div>

        {snack && (
          <div
            role="status"
            style={{
              position: "fixed",
              left: "50%",
              bottom: 24,
              transform: "translateX(-50%)",
              background: "var(--color-inverse-surface)",
              color: "var(--color-inverse-on-surface)",
              padding: "12px 20px",
              borderRadius: "var(--radius-sm)",
              animation: "rise 320ms var(--spring)",
              zIndex: 20,
            }}
          >
            {snack}
          </div>
        )}
      </div>
    </M3eTheme>
  );
}
