import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type DragEvent,
} from "react";
import { M3eLoadingIndicator } from "@m3e/react/loading-indicator";
import { M3eTheme } from "@m3e/react/theme";
import { checkHealth, tagViaApi } from "./api";
import {
  BROWSER_MODEL_LIST,
  BROWSER_MODELS,
} from "./browserModels";
import {
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
  releaseAllBrowserMemory,
  releaseBrowserSessions,
  tagEnsembleInBrowser,
  tagInBrowser,
  type LoadProgress,
} from "./wdBrowser";
import { forceUncensoredTags, forcedPrefixTags, setCustomDropTags, setCustomInsertTags, setInsertQualityEnabled } from "./forceUncensored";
import { generateSdPromptWithGrok } from "./grokPrompt";
import { ensureTagJaLoaded, isTagJaReady, translateTag } from "./tagJa";
import { SettingsPanel } from "./SettingsPanel";
import { DropTagsDialog } from "./DropTagsDialog";
import { InsertTagsDialog } from "./InsertTagsDialog";
import { LogDialog } from "./LogDialog";
import { clearLastImage, loadLastImage, saveLastImage } from "./lastImage";
import {
  describeError,
  getPreviousSessionReport,
  logError,
  logInfo,
  logWarn,
  markAnalyzing,
} from "./diagnostics";

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
  const [showDropTags, setShowDropTags] = useState(false);
  const [showInsertTags, setShowInsertTags] = useState(false);
  const [showLog, setShowLog] = useState(false);
  // A hard tab kill leaves no error to show, so the last session's verdict gets
  // its own banner instead of a snack that another message can overwrite.
  const [crashNotice, setCrashNotice] = useState(() => getPreviousSessionReport());
  const [apiStatus, setApiStatus] = useState<string>("準備完了 · 解析時にモデルを取得します");
  const [modelReady, setModelReady] = useState(true);
  const [loadProgress, setLoadProgress] = useState<LoadProgress | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [grokBusy, setGrokBusy] = useState(false);
  const [tagJaReady, setTagJaReady] = useState(() => isTagJaReady());
  const [tagVotes, setTagVotes] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const copyResetRef = useRef<number | null>(null);
  const fileRef = useRef<File | null>(null);
  fileRef.current = file;
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

  // Lazy-load EN→JA dictionary when the user wants glosses (default on).
  useEffect(() => {
    if (!settings.showTagJa) return;
    let cancelled = false;
    void ensureTagJaLoaded()
      .then(() => {
        if (!cancelled) setTagJaReady(true);
      })
      .catch(() => {
        if (!cancelled) setTagJaReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.showTagJa]);


  // Only free other models when the active selection changes — never on every render.
  useEffect(() => {
    if (settings.engine !== "browser") return;
    if (settings.tagRunMode === "single") {
      void releaseBrowserSessions(settings.browserModel);
      return;
    }
    // Merge mode: drop singles so the ensemble can load members one-by-one.
    void releaseBrowserSessions();
  }, [settings.engine, settings.tagRunMode, settings.browserModel]);

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
        setApiStatus(
          `ブラウザ推論 · ${label}（初回のみ約${sizeHint}MB · 以降は端末キャッシュ）`,
        );
        void preloadBrowserTags(runModels, onWdProgress, ac.signal)
          .then(() => {
            if (!ac.signal.aborted) {
              setApiStatus(
                `${label} · 解析時にモデル読込（初回のみDL・以降キャッシュ）`,
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

  // Bring the previous image back on load, including after iOS drops the tab,
  // so a reset never means picking the same file again.
  useEffect(() => {
    let cancelled = false;
    void loadLastImage().then((restored) => {
      if (cancelled || !restored || fileRef.current) return;
      setFile(restored);
      setPreviewUrl(URL.createObjectURL(restored));
      setSnack("前回の画像を復元しました");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pickFile = (next: File | null) => {
    if (next) {
      logInfo("image picked", {
        mb: Math.round((next.size / 1e6) * 10) / 10,
        type: next.type || "unknown",
        name: next.name?.slice(0, 40),
      });
    } else {
      logInfo("image cleared");
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
    setResult(null);
    setEditableTags([]);
    setPrompt("");
    setError(null);
    setCopied(false);
    setTagVotes({});
    if (next) {
      void saveLastImage(next).catch((err) =>
        logWarn("saveLastImage failed", describeError(err)),
      );
      startTransition(() => setScreen("home"));
    } else {
      void clearLastImage().catch((err) =>
        logWarn("clearLastImage failed", describeError(err)),
      );
      setScreen("home");
    }
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
        .replace(
          /\b(mosaic|censor(?:ed|ing| bar)?|bar censor|pixelated|monochrome|grayscale|greyscale|comic|manga|4koma|lineart|sketch|speech bubble|screentone|halftone|multiple views)\b/gi,
          "",
        )
        .replace(/\s{2,}/g, " ")
        .trim();
      if (/\buncensored\b/i.test(cleaned)) return cleaned;
      return cleaned ? `${cleaned} uncensored.` : "uncensored";
    }
    if (mode === "hybrid" && caption) return `${caption}\n\n${tagPart}`;
    return tagPart;
  };

  // The drop / insert lists live in a module-level registry because the ONNX
  // layer filters too — App just keeps them in sync with settings.
  useEffect(() => {
    setCustomDropTags(settings.dropTags);
    setCustomInsertTags(settings.insertTags);
    setInsertQualityEnabled(settings.insertQualityTags);
    if (editableTags.length === 0) return;
    const next = forceUncensoredTags(editableTags);
    setEditableTags(next);
    setPrompt(rebuildPrompt(next, result?.caption ?? null, settings.mode));
    setCopied(false);
  }, [settings.dropTags, settings.insertTags, settings.insertQualityTags]);

  const runTag = async () => {
    if (!file) return;
    setError(null);
    setCopied(false);
    setScreen("working");
    const startedAt = performance.now();
    markAnalyzing(true);
    logInfo("analyze start", {
      engine: settings.engine,
      runMode: settings.tagRunMode,
      models: runModels.join("+"),
      mode: settings.mode,
      threshold: settings.threshold,
      imageMb: Math.round((file.size / 1e6) * 10) / 10,
    });
    // Start every analysis from a clean heap: the button is disabled while a run
    // is in flight, so nothing is using these sessions here.
    if (settings.engine === "browser") {
      setLoadProgress(null);
      setApiStatus("メモリを解放中…");
      try {
        await releaseAllBrowserMemory();
      } catch (err) {
        // Freeing memory is best effort; a failure here must not block the run.
        logWarn("release before analyze failed", describeError(err));
      }
    }
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
      logInfo("analyze done", {
        ms: performance.now() - startedAt,
        tags: forcedTags.length,
        device: next.device,
      });
      if (forcedTags.length === 0) {
        setSnack("しきい値を超えるタグがありませんでした。設定でしきい値を下げてください");
      }
    } catch (err) {
      const message = formatModelLoadError(err) || "解析に失敗しました";
      logError("analyze failed", {
        ms: performance.now() - startedAt,
        engine: settings.engine,
        models: runModels.join("+"),
        shown: message,
        ...describeError(err),
      });
      setError(message);
      setScreen("home");
    } finally {
      markAnalyzing(false);
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

  const runGrokPrompt = async () => {
    if (grokBusy) return;
    if (!settings.xaiApiKey.trim()) {
      setSnack("設定で xAI API キーを入力してください（従量課金）");
      setShowSettings(true);
      return;
    }
    const tags = editableTags.map((t) => t.tag);
    if (tags.length === 0 && !prompt.trim()) {
      setSnack("先に画像を解析してください");
      return;
    }
    setGrokBusy(true);
    try {
      const out = await generateSdPromptWithGrok({
        apiKey: settings.xaiApiKey,
        model: settings.grokModel,
        tags,
        currentPrompt: prompt,
        caption: result?.caption ?? null,
      });
      setPrompt(out.prompt);
      setCopied(false);
      setSnack(`Grok がプロンプトを作成しました（${out.model}）`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Grok プロンプト生成に失敗しました";
      setError(message);
      setSnack(message);
    } finally {
      setGrokBusy(false);
    }
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
            onClick={() => setShowSettings(true)}
          >
            設定
          </button>
        </div>

        <SettingsPanel
          open={showSettings}
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          onEditDropTags={() => setShowDropTags(true)}
          onEditInsertTags={() => setShowInsertTags(true)}
          onOpenLog={() => setShowLog(true)}
          onSnack={setSnack}
        />

        <DropTagsDialog
          open={showDropTags}
          tags={settings.dropTags}
          onChange={(dropTags) => setSettings((s) => ({ ...s, dropTags }))}
          onClose={() => setShowDropTags(false)}
        />

        <InsertTagsDialog
          open={showInsertTags}
          tags={settings.insertTags}
          qualityEnabled={settings.insertQualityTags}
          onChange={(insertTags) => setSettings((s) => ({ ...s, insertTags }))}
          onClose={() => setShowInsertTags(false)}
        />

        <LogDialog
          open={showLog}
          onClose={() => setShowLog(false)}
          onNotify={setSnack}
        />

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
                    {BROWSER_MODEL_LIST.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        className="mode-btn"
                        aria-checked={settings.browserModel === m.id}
                        title={`${m.label} · 約${m.sizeMb}MB`}
                        onClick={() => {
                          if (settings.browserModel === m.id) return;
                          setSettings((s) => ({ ...s, browserModel: m.id }));
                          setSnack(
                            `${m.shortLabel} に切替 · 初回は約${m.sizeMb}MB`,
                          );
                        }}
                      >
                        {m.shortLabel}
                      </button>
                    ))}
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
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`ensemble-chip ${on ? "is-on" : ""}`}
                          title={m.description}
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

          {crashNotice && (
            <div className="notice" role="status">
              <span>
                {crashNotice.analyzing
                  ? "前回は解析中に強制終了しました。メモリ不足の可能性が高いので、単体モデルか軽いモデルで試してください。"
                  : "前回は正常に終了していません。"}
                {crashNotice.lastMsg ? `（最後の記録: ${crashNotice.lastMsg}）` : ""}
              </span>
              <div className="error-actions">
                <button type="button" onClick={() => setShowLog(true)}>
                  ログを見る
                </button>
                <button type="button" onClick={() => setCrashNotice(null)}>
                  閉じる
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <div className="error-actions">
                <button type="button" onClick={() => void runTag()} disabled={!canAnalyze}>
                  再試行
                </button>
                <button type="button" onClick={() => setShowLog(true)}>
                  ログを見る
                </button>
              </div>
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
                  <div className="prompt-actions">
                    <button
                      type="button"
                      className="btn-text"
                      onClick={() => void runGrokPrompt()}
                      disabled={grokBusy}
                      title={
                        settings.xaiApiKey.trim()
                          ? "Grok で SD 用プロンプトを作成（従量課金）"
                          : "設定で xAI API キーが必要です"
                      }
                    >
                      {grokBusy ? "Grok 生成中…" : "Grokで作成"}
                    </button>
                    <span className="muted result-sub">
                      {tagCount > 0 ? `${tagCount} tags` : "編集可"}
                    </span>
                  </div>
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
                    {editableTags.map((t) => {
                      const locked = forcedPrefixTags().includes(
                        t.tag.trim().toLowerCase().replaceAll("_", " "),
                      );
                      const ja =
                        settings.showTagJa && tagJaReady
                          ? translateTag(t.tag)
                          : null;
                      return (
                        <button
                          key={t.tag}
                          type="button"
                          className={`tag-chip ${locked ? "tag-locked" : ""}`}
                          onClick={() => {
                            if (!locked) removeTag(t.tag);
                          }}
                          title={
                            locked
                              ? "設定の挿入タグから変更できます"
                              : tagVotes[t.tag]
                                ? `${tagVotes[t.tag]}モデルが一致 · クリックで削除`
                                : "クリックで削除"
                          }
                        >
                          <span className="tag-chip-main">
                            <span className="tag-en">{t.tag}</span>
                            {ja ? <span className="tag-ja">{ja}</span> : null}
                          </span>
                          {tagVotes[t.tag] && tagVotes[t.tag] > 1 && (
                            <span className="vote">×{tagVotes[t.tag]}</span>
                          )}
                          <span className="score">{t.score.toFixed(2)}</span>
                        </button>
                      );
                    })}
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
              className="btn btn-tonal btn-dock-grok"
              onClick={() => void runGrokPrompt()}
              disabled={grokBusy}
            >
              {grokBusy ? "Grok 生成中…" : "Grokで作成"}
            </button>
            <button
              type="button"
              className={`btn btn-primary btn-dock-copy ${copied ? "is-copied" : ""}`}
              onClick={() => void copyPrompt()}
              disabled={!prompt.trim() || grokBusy}
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
