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
import { BROWSER_MODELS } from "./browserModels";
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
import { ensureTagJaLoaded, isTagJaReady } from "./tagJa";
import { SettingsPanel } from "./SettingsPanel";
import { DropTagsDialog } from "./DropTagsDialog";
import { InsertTagsDialog } from "./InsertTagsDialog";
import { LogDialog } from "./LogDialog";
import { TagChipList } from "./TagChipList";
import { TagLibraryDialog } from "./TagLibraryDialog";
import { TagsFullscreenDialog } from "./TagsFullscreenDialog";
import { CropImageDialog } from "./CropImageDialog";
import { clearLastImage, loadLastImage, saveLastImage } from "./lastImage";
import {
  addFavorite,
  buildTagSet,
  importFromStorageIfEmpty,
  isFavorite,
  loadCustomJaMap,
  loadLastSession,
  probeTagLibraryError,
  removeFavorite,
  saveGeneratedSet,
  saveLastSession,
  setSupabaseAnonKeyProvider,
  type TagSetRecord,
} from "./tagLibrary";
import { TAG_LIBRARY_SCHEMA_SQL } from "./tagLibrarySchema";
import { SUPABASE_PROJECT_REF } from "./supabaseClient";
import {
  describeError,
  getPreviousSessionReport,
  logError,
  logInfo,
  logWarn,
  markAnalyzing,
} from "./diagnostics";

type Screen = "home" | "working" | "result";
type LibraryStatus =
  | { state: "checking" }
  | { state: "ready" }
  | { state: "off"; detail: string }
  | { state: "error"; detail: string };

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
  const [showTagsFs, setShowTagsFs] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showCrop, setShowCrop] = useState(false);
  const [undoStack, setUndoStack] = useState<TagScore[]>([]);
  const [customJa, setCustomJa] = useState<Record<string, string>>({});
  const [favorited, setFavorited] = useState(false);
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
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>({
    state: "checking",
  });
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const copyResetRef = useRef<number | null>(null);
  const fileRef = useRef<File | null>(null);
  fileRef.current = file;
  const sessionIdRef = useRef<string | null>(null);
  const sessionCreatedAtRef = useRef<number | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const editableTagsRef = useRef(editableTags);
  const promptRefValue = useRef(prompt);
  const resultRefValue = useRef(result);
  const tagVotesRef = useRef(tagVotes);
  editableTagsRef.current = editableTags;
  promptRefValue.current = prompt;
  resultRefValue.current = result;
  tagVotesRef.current = tagVotes;
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
    // Always use the baked-in public key (Settings no longer collects one).
    setSupabaseAnonKeyProvider(() => "");
  }, []);

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
    });
    return () => window.cancelAnimationFrame(id);
  }, [screen, result]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
  }, []);

  const refreshCustomJa = () => {
    void loadCustomJaMap().then(setCustomJa);
  };

  useEffect(() => {
    refreshCustomJa();
  }, []);

  const rebuildPrompt = (
    tags: TagScore[],
    caption: string | null,
    mode: OutputMode,
  ) => {
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

  const snapshotCurrentSet = (
    tags: TagScore[],
    nextPrompt: string,
    opts?: {
      asNewHistory?: boolean;
      caption?: string | null;
      mode?: OutputMode;
      votes?: Record<string, number>;
      sourceNote?: string;
    },
  ): TagSetRecord => {
    const id =
      opts?.asNewHistory || !sessionIdRef.current
        ? undefined
        : sessionIdRef.current;
    const createdAt =
      opts?.asNewHistory || !sessionCreatedAtRef.current
        ? undefined
        : sessionCreatedAtRef.current;
    const record = buildTagSet({
      id,
      createdAt,
      tags,
      prompt: nextPrompt,
      caption:
        opts?.caption !== undefined
          ? opts.caption
          : (resultRefValue.current?.caption ?? null),
      mode:
        opts?.mode ?? resultRefValue.current?.mode ?? settings.mode,
      votes: opts?.votes ?? tagVotesRef.current,
      sourceNote:
        opts?.sourceNote ?? resultRefValue.current?.source?.note ?? "",
      imageName: fileRef.current?.name ?? "",
    });
    sessionIdRef.current = record.id;
    sessionCreatedAtRef.current = record.createdAt;
    return record;
  };

  const scheduleSessionSave = (tags: TagScore[], nextPrompt: string) => {
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      const record = snapshotCurrentSet(tags, nextPrompt);
      void saveLastSession(record);
    }, 400);
  };

  const applyTagSet = (record: TagSetRecord) => {
    sessionIdRef.current = record.id;
    sessionCreatedAtRef.current = record.createdAt;
    const tags = forceUncensoredTags(record.tags);
    const nextPrompt =
      record.prompt?.trim() ||
      rebuildPrompt(tags, record.caption, record.mode || settings.mode);
    setEditableTags(tags);
    setPrompt(nextPrompt);
    setTagVotes(record.votes ?? {});
    setUndoStack([]);
    setCopied(false);
    setResult({
      mode: record.mode || settings.mode,
      tags,
      prompt: nextPrompt,
      caption: record.caption,
      source: {
        wd: "library",
        note: record.sourceNote || "タグライブラリから読み込み",
      },
      device: "local",
      mock: false,
    });
    setScreen("result");
    void isFavorite(record.id).then(setFavorited);
    void saveLastSession({
      ...record,
      tags,
      prompt: nextPrompt,
      updatedAt: Date.now(),
    });
  };

  const refreshLibraryStatus = async (): Promise<boolean> => {
    setSupabaseAnonKeyProvider(() => "");
    const err = await probeTagLibraryError();
    if (!err) {
      setLibraryStatus({ state: "ready" });
      return true;
    }
    setLibraryStatus({ state: "error", detail: err });
    return false;
  };

  // Restore last image (local) + last tags from Supabase tables.
  useEffect(() => {
    let cancelled = false;
    setSupabaseAnonKeyProvider(() => "");
    void (async () => {
      const restoredImage = await loadLastImage();
      if (cancelled) return;
      if (restoredImage && !fileRef.current) {
        setFile(restoredImage);
        setPreviewUrl(URL.createObjectURL(restoredImage));
      }
      const ready = await refreshLibraryStatus();
      if (cancelled) return;
      let imported = false;
      if (ready) {
        imported = await importFromStorageIfEmpty();
        if (cancelled) return;
        refreshCustomJa();
      }
      const session = ready ? await loadLastSession() : null;
      if (cancelled) return;
      if (session?.tags?.length) {
        applyTagSet(session);
        setSnack(
          restoredImage
            ? "Supabase のタグと前回の画像を復元しました"
            : imported
              ? "Storage から取り込み、前回のタグを復元しました"
              : "Supabase から前回のタグを復元しました",
        );
      } else if (imported) {
        setSnack("Storage のタグライブラリを DB に取り込みました");
      } else if (restoredImage) {
        setSnack(
          ready
            ? "前回の画像を復元しました"
            : "前回の画像を復元（タグDB未接続）",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore
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
    setUndoStack([]);
    setFavorited(false);
    sessionIdRef.current = null;
    sessionCreatedAtRef.current = null;
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

  // The drop / insert lists live in a module-level registry because the ONNX
  // layer filters too — App just keeps them in sync with settings.
  useEffect(() => {
    setCustomDropTags(settings.dropTags);
    setCustomInsertTags(settings.insertTags);
    setInsertQualityEnabled(settings.insertQualityTags);
    if (editableTags.length === 0) return;
    const next = forceUncensoredTags(editableTags);
    const nextPrompt = rebuildPrompt(
      next,
      result?.caption ?? null,
      settings.mode,
    );
    setEditableTags(next);
    setPrompt(nextPrompt);
    setCopied(false);
    scheduleSessionSave(next, nextPrompt);
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
      let nextVotes: Record<string, number> = {};
      if (settings.engine === "local-api") {
        next = await tagViaApi(file, settings);
        nextVotes = {};
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
          nextVotes = ensemble.votes;
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
          nextVotes = {};
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
      setUndoStack([]);
      sessionIdRef.current = null;
      sessionCreatedAtRef.current = null;
      const record = snapshotCurrentSet(forcedTags, nextPrompt, {
        asNewHistory: true,
        caption: next.caption,
        mode: next.mode,
        votes: nextVotes,
        sourceNote: next.source?.note ?? "",
      });
      void saveGeneratedSet(record)
        .then(() => {
          void isFavorite(record.id).then(setFavorited);
          refreshCustomJa();
          void refreshLibraryStatus();
        })
        .catch((err) => {
          const raw = describeError(err).message;
          const msg = typeof raw === "string" && raw ? raw : String(err);
          setSnack(
            /Could not find the table|PGRST205/i.test(msg)
              ? "タグをDBに保存できません（テーブル未作成）。設定から SQL を実行してください"
              : `タグのDB保存に失敗: ${msg}`,
          );
          void refreshLibraryStatus();
        });
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
    const removed = editableTags.find((t) => t.tag === tag);
    if (!removed) return;
    if (forcedPrefixTags().includes(
      tag.trim().toLowerCase().replaceAll("_", " "),
    )) {
      return;
    }
    const tags = forceUncensoredTags(editableTags.filter((t) => t.tag !== tag));
    const nextPrompt = rebuildPrompt(
      tags,
      result?.caption ?? null,
      settings.mode,
    );
    setUndoStack((prev) => [...prev, removed]);
    setEditableTags(tags);
    setPrompt(nextPrompt);
    setCopied(false);
    setSnack(`「${tag}」を削除 · 戻すで復元できます`);
    scheduleSessionSave(tags, nextPrompt);
  };

  const undoRemoveTag = () => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const restored = prev[prev.length - 1];
      const nextStack = prev.slice(0, -1);
      const merged = forceUncensoredTags([
        ...editableTagsRef.current.filter((t) => t.tag !== restored.tag),
        restored,
      ]);
      const nextPrompt = rebuildPrompt(
        merged,
        resultRefValue.current?.caption ?? null,
        settings.mode,
      );
      setEditableTags(merged);
      setPrompt(nextPrompt);
      setCopied(false);
      scheduleSessionSave(merged, nextPrompt);
      setSnack(`「${restored.tag}」を戻しました`);
      return nextStack;
    });
  };

  const toggleCurrentFavorite = async () => {
    if (!sessionIdRef.current || editableTags.length === 0) {
      setSnack("先にタグを生成してください");
      return;
    }
    const record = snapshotCurrentSet(editableTags, prompt);
    try {
      if (favorited) {
        await removeFavorite(record.id);
        setFavorited(false);
        setSnack("お気に入りを解除しました");
      } else {
        await addFavorite(record);
        setFavorited(true);
        setSnack("お気に入りに追加しました");
      }
    } catch {
      setSnack("お気に入りの更新に失敗しました");
    }
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
      scheduleSessionSave(editableTagsRef.current, out.prompt);
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

  const promptFromTags = () =>
    editableTags
      .map((t) => t.tag)
      .filter(Boolean)
      .join(", ");

  const copyPrompt = async () => {
    const text = promptFromTags() || prompt.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setSnack("カンマ区切りでコピーしました");
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setSnack("コピーに失敗しました");
    }
  };

  const applyCroppedImage = (next: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    // Crop changes the pixels — clear prior tags so the next analyze matches.
    setResult(null);
    setEditableTags([]);
    setPrompt("");
    setTagVotes({});
    setUndoStack([]);
    setFavorited(false);
    sessionIdRef.current = null;
    sessionCreatedAtRef.current = null;
    setScreen("home");
    void saveLastImage(next).catch((err) =>
      logWarn("saveLastImage failed", describeError(err)),
    );
    setSnack("クロップを保存しました。再解析してください");
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
          <h1 className="toolbar-brand">vision</h1>
          <span className="muted toolbar-status" title={apiStatus}>
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
          onOpenLibrary={() => {
            setShowSettings(false);
            setShowLibrary(true);
          }}
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

        <TagLibraryDialog
          open={showLibrary}
          onClose={() => setShowLibrary(false)}
          onLoadSet={applyTagSet}
          onNotify={setSnack}
          onDictChanged={refreshCustomJa}
        />

        <TagsFullscreenDialog
          open={showTagsFs}
          tags={editableTags}
          votes={tagVotes}
          showJa={settings.showTagJa && tagJaReady}
          customJa={customJa}
          canUndo={undoStack.length > 0}
          onRemove={removeTag}
          onUndo={undoRemoveTag}
          onCopy={() => void copyPrompt()}
          onClose={() => setShowTagsFs(false)}
          copied={copied}
        />

        <CropImageDialog
          open={showCrop}
          file={file}
          onClose={() => setShowCrop(false)}
          onCropped={applyCroppedImage}
          onError={(message) => setSnack(message)}
        />

        <div className="stack">
          {previewUrl ? (
            <div className="image-hero">
              <div className="image-hero-stage">
                <button
                  type="button"
                  className="image-hero-frame"
                  onClick={() => inputRef.current?.click()}
                  title="画像を変更"
                  aria-label="画像を変更"
                >
                  <img src={previewUrl} alt="選択中の画像" />
                </button>
              </div>
              <div className="image-hero-bar">
                <p className="muted image-hero-meta">
                  {showingResult
                    ? `${settings.mode}${tagCount ? ` · ${tagCount} tags` : ""}${
                        result?.device ? ` · ${result.device}` : ""
                      }`
                    : file?.name || "選択中の画像"}
                </p>
                <div className="image-hero-actions">
                  <button
                    type="button"
                    className="btn-text"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!file) {
                        setSnack("先に画像を選択してください");
                        return;
                      }
                      setShowCrop(true);
                    }}
                  >
                    クロップ
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => inputRef.current?.click()}
                  >
                    変更
                  </button>
                  {showingResult && (
                    <>
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
                    </>
                  )}
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
              <strong>画像をドロップ</strong>
              <span className="muted">クリックでも選択可</span>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          {!showingResult && (
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

          {libraryStatus.state !== "checking" &&
            libraryStatus.state !== "ready" && (
              <div className="notice" role="status">
                <span>
                  タグライブラリ未接続:{" "}
                  {"detail" in libraryStatus
                    ? libraryStatus.detail
                    : "Supabase を確認してください"}
                </span>
                <div className="error-actions">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(TAG_LIBRARY_SCHEMA_SQL)
                        .then(
                          () =>
                            setSnack(
                              "スキーマ SQL をコピーしました。SQL Editor で実行してください",
                            ),
                          () => setSnack("コピーに失敗しました"),
                        );
                    }}
                  >
                    SQLをコピー
                  </button>
                  <a
                    className="btn-text"
                    href={`https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/sql/new`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    SQL Editor
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowSettings(true)}
                  >
                    設定
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void refreshLibraryStatus().then((ok) => {
                        if (ok) {
                          setSnack("Supabase テーブルに接続できました");
                          refreshCustomJa();
                        } else {
                          setSnack("まだ未接続です");
                        }
                      });
                    }}
                  >
                    再確認
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

              {editableTags.length === 0 && (
                <div className="prompt-block">
                  <div className="prompt-label-row">
                    <label className="prompt-label" htmlFor="prompt-field">
                      プロンプト
                    </label>
                    <span className="muted result-sub">編集可</span>
                  </div>
                  <div className="prompt-shell">
                    <textarea
                      id="prompt-field"
                      ref={promptRef}
                      className="prompt-box"
                      value={prompt}
                      onChange={(e) => {
                        const value = e.target.value;
                        setPrompt(value);
                        setCopied(false);
                        scheduleSessionSave(editableTagsRef.current, value);
                      }}
                      aria-label="生成プロンプト"
                      rows={6}
                    />
                  </div>
                </div>
              )}

              {editableTags.length > 0 && (
                <div className="tags-block">
                  <div className="tags-head">
                    <h3 className="tags-title">タグ · 2秒長押しで削除</h3>
                    <div className="tags-head-actions">
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => void toggleCurrentFavorite()}
                        title={favorited ? "お気に入り解除" : "お気に入り"}
                      >
                        {favorited ? "★" : "☆"}
                      </button>
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => setShowLibrary(true)}
                      >
                        履歴
                      </button>
                      <button
                        type="button"
                        className="btn-text"
                        disabled={undoStack.length === 0}
                        onClick={undoRemoveTag}
                      >
                        戻す
                      </button>
                      <button
                        type="button"
                        className="btn-text"
                        onClick={() => setShowTagsFs(true)}
                      >
                        全画面
                      </button>
                    </div>
                  </div>
                  <TagChipList
                    tags={editableTags}
                    votes={tagVotes}
                    showJa={settings.showTagJa && tagJaReady}
                    customJa={customJa}
                    onRemove={removeTag}
                  />
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
              disabled={(!tagCount && !prompt.trim()) || grokBusy}
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
