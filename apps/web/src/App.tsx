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
import { preloadWdBrowser, tagInBrowser, type LoadProgress } from "./wdBrowser";
import { forceUncensoredTags } from "./forceUncensored";

type Screen = "home" | "working" | "result";

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
  const [apiStatus, setApiStatus] = useState<string>("準備完了 · 解析時にモデルを取得します");
  const [modelReady, setModelReady] = useState(true);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const copyResetRef = useRef<number | null>(null);
  const onPages = isGitHubPagesHost();
  const showingResult = screen === "result" && !!result;

  const onWdProgress = (p: LoadProgress) => {
    setLoadProgress(p);
    setApiStatus(p.message);
  };

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (settings.engine === "browser") {
        setModelReady(true);
        setApiStatus("ブラウザ推論 · 初回はモデル取得あり（約360MB）");
        void preloadWdBrowser(onWdProgress)
          .then(() => {
            if (!cancelled) {
              setApiStatus("ブラウザ内 WD ViT 準備完了（端末ローカル）");
              setLoadProgress(null);
            }
          })
          .catch((err) => {
            if (!cancelled) {
              setApiStatus(
                err instanceof Error
                  ? `モデル取得待ち: ${err.message}`
                  : "モデル取得に失敗（解析時に再試行）",
              );
            }
          });
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

      setSettings((s) => ({ ...s, engine: "browser" }));
      setModelReady(true);
      setApiStatus("API 未接続のためブラウザ推論に切替（初回約360MB）");
      setSnack("ローカル API に接続できないため、ブラウザ内 WD14 に切り替えました");
      void preloadWdBrowser(onWdProgress).catch(() => undefined);
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

  useEffect(() => {
    if (screen !== "result") return;
    const id = window.requestAnimationFrame(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      promptRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [screen, result]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
    };
  }, []);

  const pickFile = (next: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
    setResult(null);
    setEditableTags([]);
    setPrompt("");
    setError(null);
    setCopied(false);
    if (next) startTransition(() => setScreen("home"));
    else setScreen("home");
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) pickFile(f);
  };

  const rebuildPrompt = (tags: TagScore[], caption: string | null, mode: OutputMode) => {
    const forced = forceUncensoredTags(tags);
    const tagPart = forced.map((t) => t.tag).join(", ");
    if (mode === "caption") {
      const base = caption ?? "";
      if (!base.trim()) return "uncensored";
      const cleaned = base
        .replace(/\b(mosaic|censor(?:ed|ing| bar)?|bar censor|pixelated)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (/\buncensored\b/i.test(cleaned)) return cleaned;
      return cleaned ? `${cleaned} uncensored.` : "uncensored";
    }
    if (mode === "hybrid" && caption) return `${caption}\n\n${tagPart}`;
    return tagPart;
  };

  const runTag = async () => {
    if (!file) return;
    setError(null);
    setCopied(false);
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
        const browser = await tagInBrowser(
          file,
          {
            threshold: settings.threshold,
            characterThreshold: settings.characterThreshold,
            includeRating: settings.includeRating,
          },
          onWdProgress,
        );
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
      const forcedTags = forceUncensoredTags(next.tags);
      const nextPrompt = rebuildPrompt(forcedTags, next.caption, settings.mode);
      setEditableTags(forcedTags);
      setPrompt(nextPrompt);
      setResult({ ...next, tags: forcedTags, prompt: nextPrompt });
      setScreen("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析に失敗しました");
      setScreen("home");
    }
  };

  const removeTag = (tag: string) => {
    const tags = forceUncensoredTags(editableTags.filter((t) => t.tag !== tag));
    setEditableTags(tags);
    setPrompt(rebuildPrompt(tags, result?.caption ?? null, settings.mode));
    setCopied(false);
  };

  const syncPromptFromTags = () => {
    const next = rebuildPrompt(editableTags, result?.caption ?? null, settings.mode);
    setPrompt(next);
    setCopied(false);
    setSnack("タグからプロンプトを再生成しました");
  };

  const copyPrompt = async () => {
    if (!prompt.trim()) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setSnack("プロンプトをコピーしました");
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setSnack("コピーに失敗しました。手動で選択してください");
      promptRef.current?.select();
    }
  };

  const runTagRef = useRef(runTag);
  const copyPromptRef = useRef(copyPrompt);
  runTagRef.current = runTag;
  copyPromptRef.current = copyPrompt;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "Enter" && file && screen !== "working" && modelReady) {
        e.preventDefault();
        void runTagRef.current();
      }
      if (meta && e.shiftKey && (e.key === "c" || e.key === "C") && showingResult) {
        e.preventDefault();
        void copyPromptRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, screen, modelReady, showingResult]);

  const thresholdPercent = useMemo(
    () => Math.round(settings.threshold * 100),
    [settings.threshold],
  );

  const tagCount = editableTags.length;
  const canAnalyze = !!file && screen !== "working" && modelReady;

  return (
    <M3eTheme color="#0E7490" variant="tonal-spot" scheme="light" motion="expressive">
      <div className="atmosphere" aria-hidden="true">
        <div className="aurora-shard a" />
        <div className="aurora-shard b" />
      </div>
      <div className={`app-shell ${showingResult ? "has-dock" : ""}`}>
        <div className="toolbar">
          <span className="muted" title={apiStatus}>
            {apiStatus || "準備中…"}
          </span>
          <M3eButton variant="text" onClick={() => setShowSettings((v) => !v)}>
            設定
          </M3eButton>
        </div>

        {showSettings && (
          <div className="settings">
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
              <span className="check-line">
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
                <span className="check-line">
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

        <header className={`brand ${showingResult ? "brand-compact" : ""}`}>
          <h1>vision</h1>
          {!showingResult && <p>画像を、澄んだタグへ。端末の中だけで。</p>}
        </header>

        <div className="stack">
          {!showingResult && (
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
          )}

          {showingResult && previewUrl ? (
            <div className="workbench">
              <button
                type="button"
                className="workbench-thumb"
                onClick={() => inputRef.current?.click()}
                title="別の画像を選ぶ"
              >
                <img src={previewUrl} alt="選択中の画像" />
              </button>
              <div className="workbench-meta">
                <p className="workbench-title">解析済み</p>
                <p className="muted">
                  {settings.mode}
                  {result?.device ? ` · ${result.device}` : ""}
                  {result?.source.wd ? ` · ${result.source.wd}` : ""}
                </p>
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!canAnalyze}
                    onClick={() => void runTag()}
                  >
                    再解析
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => inputRef.current?.click()}
                  >
                    画像を変更
                  </button>
                </div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <>
              <div
                className={`dropzone ${dragging ? "dragging" : ""} ${screen === "working" ? "busy" : ""}`}
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
                    <span className="muted">
                      またはクリック · PNG / JPEG / WebP
                    </span>
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

              <div className="row analyze-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canAnalyze}
                  onClick={() => void runTag()}
                >
                  {screen === "working" ? "解析中…" : "解析する"}
                </button>
                {file && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => pickFile(null)}
                  >
                    クリア
                  </button>
                )}
                <span className="muted shortcut-hint">⌘/Ctrl + Enter</span>
              </div>
            </>
          )}

          {screen === "working" && (
            <div className="status-line panel" role="status" aria-live="polite">
              <M3eLoadingIndicator />
              <span>
                {loadProgress?.message ||
                  apiStatus ||
                  "情景とタグを読み取っています…"}
              </span>
            </div>
          )}

          {loadProgress &&
            screen !== "working" &&
            loadProgress.phase !== "ready" &&
            loadProgress.phase !== "idle" && (
              <div className="panel muted">
                {loadProgress.message}
                {loadProgress.total > 0 && loadProgress.phase === "model" && (
                  <>
                    {" "}
                    (
                    {Math.min(
                      99,
                      Math.round(
                        (loadProgress.loaded / loadProgress.total) * 100,
                      ),
                    )}
                    %)
                  </>
                )}
              </div>
            )}

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          {showingResult && result && (
            <section className="result panel stack" ref={resultRef}>
              <div className="result-head">
                <div>
                  <h2 className="section-title">プロンプト</h2>
                  <p className="muted result-sub">
                    {tagCount > 0 ? `${tagCount} tags` : "編集してコピー"}
                    {result.source.joy ? ` · joy` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={`btn btn-primary btn-copy-head ${copied ? "is-copied" : ""}`}
                  onClick={() => void copyPrompt()}
                  disabled={!prompt.trim()}
                >
                  {copied ? "コピー済み" : "コピー"}
                </button>
              </div>

              {result.source.note && (
                <p className="muted result-note">{result.source.note}</p>
              )}

              <div className="prompt-shell">
                <textarea
                  ref={promptRef}
                  className="prompt-box"
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setCopied(false);
                  }}
                  aria-label="生成プロンプト"
                  rows={5}
                />
                <button
                  type="button"
                  className={`btn-icon-copy ${copied ? "is-copied" : ""}`}
                  onClick={() => void copyPrompt()}
                  disabled={!prompt.trim()}
                  aria-label={copied ? "コピー済み" : "プロンプトをコピー"}
                  title="コピー (⌘⇧C)"
                >
                  {copied ? "済" : "Copy"}
                </button>
              </div>

              {editableTags.length > 0 && (
                <div className="tags-block">
                  <div className="tags-head">
                    <h3 className="tags-title">タグ</h3>
                    <div className="row">
                      <span className="muted">タップで除外</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={syncPromptFromTags}
                      >
                        タグから再生成
                      </button>
                    </div>
                  </div>
                  <div className="chip-wrap">
                    {editableTags.map((t) => (
                      <button
                        key={t.tag}
                        type="button"
                        className={`tag-chip ${t.tag === "uncensored" ? "tag-locked" : ""}`}
                        onClick={() => removeTag(t.tag)}
                        title={
                          t.tag === "uncensored"
                            ? "uncensored は常に付与されます"
                            : "クリックで削除"
                        }
                      >
                        {t.tag}
                        <span className="score">{t.score.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {showingResult && (
          <div className="action-dock" role="region" aria-label="結果操作">
            <button
              type="button"
              className={`btn btn-primary btn-dock-copy ${copied ? "is-copied" : ""}`}
              onClick={() => void copyPrompt()}
              disabled={!prompt.trim()}
            >
              {copied ? "コピーしました" : "プロンプトをコピー"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!canAnalyze}
              onClick={() => void runTag()}
            >
              再解析
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setScreen("home");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              戻る
            </button>
          </div>
        )}

        {snack && (
          <div
            role="status"
            className={`snack ${showingResult ? "snack-above-dock" : ""}`}
          >
            {snack}
          </div>
        )}
      </div>
    </M3eTheme>
  );
}
