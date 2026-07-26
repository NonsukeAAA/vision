import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import { M3eLoadingIndicator } from "@m3e/react/loading-indicator";
import { M3eSlider } from "@m3e/react/slider";
import { M3eSliderThumb } from "@m3e/react/slider";
import { M3eTheme } from "@m3e/react/theme";
import { checkHealth, tagViaApi } from "./api";
import {
  BROWSER_MODEL_LIST,
  BROWSER_MODELS,
  isAppleMobileUa,
  type BrowserModelId,
} from "./browserModels";
import {
  isGitHubPagesHost,
  loadSettings,
  saveSettings,
  type AppSettings,
  type OutputMode,
  type TagResult,
  type TagScore,
} from "./types";
import {
  formatModelLoadError,
  preloadBrowserTags,
  tagEnsembleInBrowser,
  tagInBrowser,
  type LoadProgress,
} from "./wdBrowser";
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
  const [tagVotes, setTagVotes] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const copyResetRef = useRef<number | null>(null);
  const onPages = isGitHubPagesHost();
  const onIphone = isAppleMobileUa();
  const showingResult = screen === "result" && !!result;
  const activeModel = BROWSER_MODELS[settings.browserModel];
  const runModels =
    settings.tagRunMode === "merge"
      ? settings.ensembleModels
      : [settings.browserModel];

  const onWdProgress = (p: LoadProgress) => {
    setLoadProgress(p);
    setApiStatus(p.message);
  };

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      if (settings.engine === "browser") {
        setModelReady(true);
        const label =
          settings.tagRunMode === "merge"
            ? `結合 ${runModels.map((id) => BROWSER_MODELS[id].shortLabel).join("+")}`
            : activeModel.shortLabel;
        const sizeHint =
          settings.tagRunMode === "merge"
            ? runModels.reduce((s, id) => s + BROWSER_MODELS[id].sizeMb, 0)
            : activeModel.sizeMb;
        // Do NOT auto-download 360MB–1.2GB ONNX on open — that OOMs / aborts on mobile
        // when the user toggles models. Warm only the small tags CSV; ONNX loads on 解析.
        setApiStatus(
          `ブラウザ推論 · ${label}（解析時に約${sizeHint}MB取得）`,
        );
        void preloadBrowserTags(runModels, onWdProgress, ac.signal)
          .then(() => {
            if (!ac.signal.aborted) {
              setApiStatus(
                `${label} · 解析時にモデル取得（約${sizeHint}MB・初回のみ）`,
              );
              setLoadProgress(null);
            }
          })
          .catch((err) => {
            if (ac.signal.aborted) return;
            if (err instanceof DOMException && err.name === "AbortError") return;
            setApiStatus(`タグ辞書: ${formatModelLoadError(err)}`);
          });
        return;
      }

      const health = await checkHealth(settings.apiBase);
      if (ac.signal.aborted) return;

      if (health.ok) {
        setModelReady(true);
        setApiStatus(
          `ローカル API 接続OK${health.mock ? " (mock)" : ""}${health.joy_available ? " · JoyCaption可" : " · JoyCaption未導入"}`,
        );
        return;
      }

      setSettings((s) => ({ ...s, engine: "browser" }));
      setModelReady(true);
      setApiStatus(`API 未接続のためブラウザ推論に切替`);
      setSnack("ローカル API に接続できないため、ブラウザ内推論に切り替えました");
    })();
    return () => {
      ac.abort();
    };
  }, [
    settings.engine,
    settings.apiBase,
    settings.browserModel,
    settings.tagRunMode,
    settings.ensembleModels.join(","),
  ]);

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
    setTagVotes({});
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
        setTagVotes({});
      } else {
        if (settings.mode === "caption") {
          throw new Error(
            "詳細キャプション（JoyCaption）はローカル API モードが必要です。設定で engine を local-api に切り替えてください。",
          );
        }
        if (settings.tagRunMode === "merge") {
          const ensemble = await tagEnsembleInBrowser(
            file,
            {
              modelIds: settings.ensembleModels,
              threshold: settings.threshold,
              characterThreshold: settings.characterThreshold,
              includeRating: settings.includeRating,
            },
            onWdProgress,
          );
          setTagVotes(ensemble.votes);
          next = {
            mode: settings.mode === "hybrid" ? "booru" : settings.mode,
            tags: ensemble.tags,
            prompt: ensemble.prompt,
            caption: null,
            source: {
              wd: ensemble.modelIds.join("+"),
              note:
                settings.mode === "hybrid"
                  ? "結合モード: 複数モデルの同一タグをマージ。JoyCaption はローカル API が必要です。"
                  : `結合モード: ${ensemble.modelIds.map((id) => BROWSER_MODELS[id].shortLabel).join(" + ")}`,
            },
            device: "wasm",
            mock: false,
          };
        } else {
          setTagVotes({});
          const browser = await tagInBrowser(
            file,
            {
              modelId: settings.browserModel,
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
            source: { wd: browser.modelId },
            device: "wasm",
            mock: false,
          };
          if (settings.mode === "hybrid") {
            next.prompt = browser.prompt;
            next.source.note =
              "GitHub Pages / ブラウザモードでは WD/PixAI タグのみ。JoyCaption 併用はローカル API を起動してください。";
          }
        }
      }
      const forcedTags = forceUncensoredTags(next.tags);
      const nextPrompt = rebuildPrompt(forcedTags, next.caption, settings.mode);
      setEditableTags(forcedTags);
      setPrompt(nextPrompt);
      setResult({ ...next, tags: forcedTags, prompt: nextPrompt });
      setScreen("result");
    } catch (err) {
      setError(formatModelLoadError(err) || "解析に失敗しました");
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
    <M3eTheme color="#3D5A80" variant="tonal-spot" scheme="light" motion="expressive">
      <div className="atmosphere" aria-hidden="true" />
      <div className={`app-shell ${showingResult ? "has-dock" : ""}`}>
        <div className="toolbar">
          <span className="muted" title={apiStatus}>
            {apiStatus || "準備中…"}
          </span>
          <button
            type="button"
            className="toolbar-gear"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? "閉じる" : "設定"}
          </button>
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
                <option value="browser">ブラウザ (WD/PixAI · 推奨 / Pages対応)</option>
                <option value="local-api">ローカル API (JoyCaption + WD14)</option>
              </select>
            </label>
            {settings.engine === "browser" && (
              <>
                <label>
                  実行モード
                  <select
                    value={settings.tagRunMode}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        tagRunMode: e.target.value as AppSettings["tagRunMode"],
                      }))
                    }
                  >
                    <option value="single">単体モデル</option>
                    <option value="merge">結合（同一タグをマージ）</option>
                  </select>
                </label>
                {settings.tagRunMode === "single" ? (
                  <label>
                    ブラウザモデル
                    <select
                      value={settings.browserModel}
                      onChange={(e) => {
                        const id = e.target.value as BrowserModelId;
                        setSettings((s) => ({ ...s, browserModel: id }));
                        setSnack(
                          `${BROWSER_MODELS[id].shortLabel} に切替 · 初回は再ダウンロードあり`,
                        );
                      }}
                    >
                      {BROWSER_MODEL_LIST.map((m) => (
                        <option
                          key={m.id}
                          value={m.id}
                          disabled={onIphone && !m.mobileFriendly}
                        >
                          {m.label}
                          {m.mobileFriendly
                            ? ` · iPhone可 · ~${m.sizeMb}MB`
                            : ` · PC推奨 · ~${m.sizeMb}MB`}
                        </option>
                      ))}
                    </select>
                    <span
                      className="muted"
                      style={{
                        marginTop: 4,
                        textTransform: "none",
                        letterSpacing: "normal",
                        fontWeight: 400,
                      }}
                    >
                      {activeModel.description}
                      {onIphone && !activeModel.mobileFriendly
                        ? " · この端末では失敗する可能性大"
                        : ""}
                    </span>
                  </label>
                ) : (
                  <div className="ensemble-pick">
                    <p className="section-title" style={{ fontSize: "0.9rem" }}>
                      結合するモデル
                    </p>
                    <p className="muted">
                      同じタグは1つにまとめ、スコアは最大値。複数一致は優先表示します。
                    </p>
                    {BROWSER_MODEL_LIST.map((m) => {
                      const checked = settings.ensembleModels.includes(m.id);
                      const blocked = onIphone && !m.mobileFriendly;
                      return (
                        <label key={m.id} className="check-line">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={blocked}
                            onChange={(e) => {
                              setSettings((s) => {
                                const next = e.target.checked
                                  ? [...s.ensembleModels, m.id]
                                  : s.ensembleModels.filter((id) => id !== m.id);
                                return {
                                  ...s,
                                  ensembleModels:
                                    next.length > 0 ? next : [s.browserModel],
                                };
                              });
                            }}
                          />
                          {m.shortLabel}
                          <span className="muted">
                            {blocked
                              ? " · iPhone非推奨"
                              : ` · ~${m.sizeMb}MB`}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </>
            )}
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
          {!showingResult && <p>画像からタグへ。すべて端末の中で。</p>}
        </header>

        <div className="stack">
          {!showingResult && settings.engine === "browser" && (
            <div className="model-picker">
              <div className="model-picker-label">
                {settings.tagRunMode === "merge" ? "結合モード" : "モデル"}
              </div>
              <div className="mode-row run-mode-row" role="radiogroup" aria-label="実行モード">
                <button
                  type="button"
                  role="radio"
                  className="mode-btn"
                  aria-checked={settings.tagRunMode === "single"}
                  onClick={() =>
                    setSettings((s) => ({ ...s, tagRunMode: "single" }))
                  }
                >
                  単体
                </button>
                <button
                  type="button"
                  role="radio"
                  className="mode-btn"
                  aria-checked={settings.tagRunMode === "merge"}
                  onClick={() =>
                    setSettings((s) => ({ ...s, tagRunMode: "merge" }))
                  }
                >
                  結合
                </button>
              </div>
              {settings.tagRunMode === "single" ? (
                <>
                  <div
                    className="mode-row model-row"
                    role="radiogroup"
                    aria-label="ブラウザモデル"
                  >
                    {BROWSER_MODEL_LIST.map((m) => {
                      const blocked = onIphone && !m.mobileFriendly;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          className="mode-btn"
                          aria-checked={settings.browserModel === m.id}
                          disabled={blocked}
                          title={
                            blocked
                              ? `iPhone では非推奨（約${m.sizeMb}MB・初期化で落ちやすい）`
                              : `${m.label} · 約${m.sizeMb}MB`
                          }
                          onClick={() => {
                            if (blocked || settings.browserModel === m.id) return;
                            setSettings((s) => ({ ...s, browserModel: m.id }));
                            setSnack(
                              `${m.shortLabel} に切替 · 初回は約${m.sizeMb}MB`,
                            );
                          }}
                        >
                          {m.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                  <p className="muted model-picker-hint">
                    {activeModel.description}
                  </p>
                </>
              ) : (
                <>
                  <div className="ensemble-chips">
                    {BROWSER_MODEL_LIST.map((m) => {
                      const on = settings.ensembleModels.includes(m.id);
                      const blocked = onIphone && !m.mobileFriendly;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`ensemble-chip ${on ? "is-on" : ""}`}
                          disabled={blocked}
                          title={
                            blocked
                              ? `iPhone では非推奨（約${m.sizeMb}MB・初期化で落ちやすい）`
                              : m.description
                          }
                          onClick={() => {
                            setSettings((s) => {
                              const next = on
                                ? s.ensembleModels.filter((id) => id !== m.id)
                                : [...s.ensembleModels, m.id];
                              return {
                                ...s,
                                ensembleModels:
                                  next.length > 0 ? next : [s.browserModel],
                              };
                            });
                          }}
                        >
                          {m.shortLabel}
                        </button>
                      );
                    })}
                  </div>
                  <p className="muted model-picker-hint">
                    同一タグは結合 · スコアは最大値 · 複数一致を優先
                  </p>
                </>
              )}
            </div>
          )}

          {!showingResult && (
            <div className="mode-row" role="radiogroup" aria-label="出力モード">
              {(
                [
                  ["booru", "Booru"],
                  ["caption", "Caption"],
                  ["hybrid", "Hybrid"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  className="mode-btn"
                  aria-checked={settings.mode === value}
                  onClick={() => setSettings((s) => ({ ...s, mode: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {showingResult && previewUrl ? (
            <div className="workbench">
              <button
                type="button"
                className="workbench-thumb"
                onClick={() => inputRef.current?.click()}
                title="画像を変更"
                aria-label="画像を変更"
              >
                <img src={previewUrl} alt="" />
              </button>
              <div className="workbench-meta">
                <p className="workbench-title">{settings.mode}</p>
                <p className="muted workbench-sub">
                  {tagCount} tags
                  {result?.device ? ` · ${result.device}` : ""}
                </p>
              </div>
              <div className="workbench-actions">
                <button
                  type="button"
                  className="btn-text"
                  disabled={!canAnalyze}
                  onClick={() => void runTag()}
                >
                  再解析
                </button>
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    setScreen("home");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  戻る
                </button>
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
                    <span className="muted">クリックでも選択可</span>
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

              <div className="cta-block">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={!canAnalyze}
                  onClick={() => void runTag()}
                >
                  {screen === "working" ? "解析中…" : "解析する"}
                </button>
                <div className="cta-meta">
                  {file ? (
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() => pickFile(null)}
                    >
                      クリア
                    </button>
                  ) : (
                    <span />
                  )}
                  <span className="shortcut-hint">⌘/Ctrl + Enter</span>
                </div>
              </div>
            </>
          )}

          {screen === "working" && (
            <div className="status-line" role="status" aria-live="polite">
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
              <div className="status-line muted">
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
            <section className="result" ref={resultRef}>
              {result.source.note && (
                <p className="muted result-note">{result.source.note}</p>
              )}

              <div className="prompt-block">
                <div className="prompt-label-row">
                  <label className="prompt-label" htmlFor="prompt-field">
                    プロンプト
                  </label>
                  <span className="muted result-sub">
                    {tagCount > 0 ? `${tagCount} tags` : "編集可"}
                  </span>
                </div>
                <div className="prompt-shell">
                  <textarea
                    id="prompt-field"
                    ref={promptRef}
                    className="prompt-box"
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      setCopied(false);
                    }}
                    aria-label="生成プロンプト"
                    rows={6}
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
              </div>

              {editableTags.length > 0 && (
                <div className="tags-block">
                  <div className="tags-head">
                    <h3 className="tags-title">タグ · タップで除外</h3>
                    <button
                      type="button"
                      className="btn-text"
                      onClick={syncPromptFromTags}
                    >
                      タグから再生成
                    </button>
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
                            : tagVotes[t.tag]
                              ? `${tagVotes[t.tag]}モデルが一致 · クリックで削除`
                              : "クリックで削除"
                        }
                      >
                        {t.tag}
                        {tagVotes[t.tag] && tagVotes[t.tag] > 1 && (
                          <span className="vote">×{tagVotes[t.tag]}</span>
                        )}
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
          <div className="action-dock" role="region" aria-label="コピー">
            <button
              type="button"
              className={`btn btn-primary btn-block btn-dock-copy ${copied ? "is-copied" : ""}`}
              onClick={() => void copyPrompt()}
              disabled={!prompt.trim()}
            >
              {copied ? "コピーしました" : "コピー"}
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
