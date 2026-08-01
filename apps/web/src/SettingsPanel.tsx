import { useCallback, useEffect, useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eDialog } from "@m3e/react/dialog";
import { M3eDivider } from "@m3e/react/divider";
import { M3eIcon } from "@m3e/react/icon";
import { M3eList } from "@m3e/react/list";
import { M3eListItem } from "@m3e/react/list";
import { M3eSlider } from "@m3e/react/slider";
import { M3eSliderThumb } from "@m3e/react/slider";
import { M3eSwitch } from "@m3e/react/switch";
import {
  BROWSER_MODEL_LIST,
  BROWSER_MODELS,
  type BrowserModelId,
} from "./browserModels";
import { formatBytes } from "./deviceResources";
import {
  clearAllCachedBrowserModels,
  deleteCachedBrowserModel,
  listCachedBrowserModels,
  type CachedModelInfo,
} from "./wdBrowser";
import { type AppSettings } from "./types";
import { getLogEntries, getPreviousSessionReport } from "./diagnostics";
import {
  ERO_BOOST_TAGS,
  insertPresetActive,
  mergeInsertPreset,
  QUALITY_INSERT_TAGS,
  removeInsertPreset,
} from "./forceUncensored";
import { probeSupabaseSync, type SyncStatus } from "./supabaseClient";
import { isTagLibraryReady } from "./tagLibrary";

type Props = {
  open: boolean;
  settings: AppSettings;
  onChange: (next: AppSettings | ((s: AppSettings) => AppSettings)) => void;
  onClose: () => void;
  onEditDropTags: () => void;
  onEditInsertTags: () => void;
  onOpenLog: () => void;
  onOpenLibrary: () => void;
  onSnack: (message: string) => void;
};

function formatSavedAt(ts: number | null): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("ja-JP", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function SettingsPanel({
  open,
  settings,
  onChange,
  onClose,
  onEditDropTags,
  onEditInsertTags,
  onOpenLog,
  onOpenLibrary,
  onSnack,
}: Props) {
  const crash = getPreviousSessionReport();
  const logCount = getLogEntries().length;
  const thresholdPercent = Math.round(settings.threshold * 100);
  const [caches, setCaches] = useState<CachedModelInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  const refresh = useCallback(async () => {
    setCaches(await listCachedBrowserModels());
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void probeSupabaseSync().then((st) => {
      if (!cancelled) setSyncStatus(st);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const patch = (partial: Partial<AppSettings>) => {
    onChange((s) => ({ ...s, ...partial }));
  };

  const eroOn = insertPresetActive(settings.insertTags, ERO_BOOST_TAGS);
  const toggleEroBoost = () => {
    const insertTags = eroOn
      ? removeInsertPreset(settings.insertTags, ERO_BOOST_TAGS)
      : mergeInsertPreset(settings.insertTags, ERO_BOOST_TAGS);
    patch({ insertTags });
    onSnack(
      eroOn
        ? "ero boost を解除しました"
        : "ero boost を挿入タグに追加しました",
    );
  };

  const removeCache = async (id: BrowserModelId) => {
    setBusy(true);
    try {
      await deleteCachedBrowserModel(id);
      await refresh();
      onSnack(`${BROWSER_MODELS[id].shortLabel} のキャッシュを削除しました`);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      await clearAllCachedBrowserModels();
      await refresh();
      onSnack("モデルキャッシュをすべて削除しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <M3eDialog
      className="settings-dialog"
      open={open}
      dismissible
      closeLabel="設定を閉じる"
      onClosed={onClose}
      onCancel={onClose}
    >
      <span slot="header">設定</span>
      <div className="settings-sheet">
        <div className="settings-block">
          <h3 className="settings-block-title">
            <M3eIcon name="tune" />
            解析モード
          </h3>
          <label className="settings-field">
            <span>出力</span>
            <select
              value={settings.mode}
              onChange={(e) =>
                patch({ mode: e.target.value as AppSettings["mode"] })
              }
            >
              <option value="booru">Booru（タグ）</option>
              <option value="caption">Caption</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label className="settings-field">
            <span>実行</span>
            <select
              value={settings.tagRunMode}
              onChange={(e) =>
                patch({
                  tagRunMode: e.target.value as AppSettings["tagRunMode"],
                })
              }
            >
              <option value="single">単体モデル</option>
              <option value="merge">結合（同一タグをマージ）</option>
            </select>
          </label>
          {settings.tagRunMode === "single" ? (
            <label className="settings-field">
              <span>モデル</span>
              <select
                value={settings.browserModel}
                onChange={(e) => {
                  const id = e.target.value as BrowserModelId;
                  patch({ browserModel: id });
                  onSnack(
                    `${BROWSER_MODELS[id].shortLabel} に切替 · 初回は再ダウンロードあり`,
                  );
                }}
              >
                {BROWSER_MODEL_LIST.map((m) => {
                  const cached = caches.find((c) => c.id === m.id)?.present;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label} · ~{m.sizeMb}MB
                      {cached ? " · 保存済" : ""}
                    </option>
                  );
                })}
              </select>
              <span className="settings-help">
                {BROWSER_MODELS[settings.browserModel].description}
              </span>
            </label>
          ) : (
            <div className="ensemble-pick">
              <p className="settings-help">
                使うモデル（複数可）。同じタグは1つにまとめ、スコアは最大値です。
              </p>
              {BROWSER_MODEL_LIST.map((m) => {
                const checked = settings.ensembleModels.includes(m.id);
                const cached = caches.find((c) => c.id === m.id)?.present;
                return (
                  <label key={m.id} className="check-line">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        onChange((s) => {
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
                      {" "}
                      · ~{m.sizeMb}MB
                      {cached ? " · 保存済" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <label className="settings-field">
            <span>一般タグ閾値 ({thresholdPercent}%)</span>
            <M3eSlider
              min={0.05}
              max={0.95}
              step={0.05}
              labelled
              onChange={(e) => {
                const target = e.target as HTMLElement & {
                  value?: number | null;
                };
                const thumb = (e.target as HTMLElement).querySelector?.(
                  "m3e-slider-thumb",
                ) as (HTMLElement & { value: number | null }) | null;
                const v = Number(thumb?.value ?? target.value);
                if (!Number.isNaN(v)) patch({ threshold: v });
              }}
            >
              <M3eSliderThumb value={settings.threshold} />
            </M3eSlider>
          </label>
          <label className="settings-switch">
            <span>rating タグを含める</span>
            <M3eSwitch
              checked={settings.includeRating}
              onChange={(e) => {
                const el = e.currentTarget as HTMLElement & {
                  checked?: boolean;
                };
                patch({ includeRating: !!el.checked });
              }}
            />
          </label>
          <label className="settings-switch">
            <span>タグに日本語訳を表示</span>
            <M3eSwitch
              checked={settings.showTagJa}
              onChange={(e) => {
                const el = e.currentTarget as HTMLElement & {
                  checked?: boolean;
                };
                patch({ showTagJa: !!el.checked });
              }}
            />
          </label>
        </div>

        <M3eDivider />

        <div className="settings-block">
          <div className="settings-block-head">
            <h3 className="settings-block-title">
              <M3eIcon name="do_not_disturb_on" />
              削除タグ
            </h3>
            <M3eButton type="button" variant="tonal" onClick={onEditDropTags}>
              <M3eIcon slot="icon" name="edit" />
              編集
            </M3eButton>
          </div>
          <p className="settings-help">
            {settings.dropTags.length > 0
              ? `追加で ${settings.dropTags.length} 件を削除中`
              : "検閲・モノクロなどは既定で削除。追加は編集から。"}
          </p>
        </div>

        <M3eDivider />

        <div className="settings-block">
          <div className="settings-block-head">
            <h3 className="settings-block-title">
              <M3eIcon name="auto_awesome" />
              挿入タグ
            </h3>
            <M3eButton type="button" variant="tonal" onClick={onEditInsertTags}>
              <M3eIcon slot="icon" name="edit" />
              編集
            </M3eButton>
          </div>
          <label className="settings-switch">
            <span>画質アップタグを自動挿入</span>
            <M3eSwitch
              checked={settings.insertQualityTags}
              onChange={(e) => {
                const el = e.currentTarget as HTMLElement & {
                  checked?: boolean;
                };
                patch({ insertQualityTags: !!el.checked });
              }}
            />
          </label>
          <div className="insert-presets settings-presets">
            <M3eButton
              type="button"
              variant={eroOn ? "filled" : "tonal"}
              className="ero-boost-btn"
              onClick={toggleEroBoost}
            >
              <M3eIcon slot="icon" name={eroOn ? "nightlife" : "dark_mode"} />
              ero boost
            </M3eButton>
          </div>
          <p className="settings-help">
            {settings.insertQualityTags
              ? `${QUALITY_INSERT_TAGS.slice(0, 3).join(", ")}… を挿入。`
              : "画質タグはオフ。"}
            {settings.insertTags.length > 0
              ? ` 追加 ${settings.insertTags.length} 件。`
              : ""}
          </p>
        </div>

        <M3eDivider />

        <div className="settings-block">
          <div className="settings-block-head">
            <h3 className="settings-block-title">
              <M3eIcon name="menu_book" />
              タグライブラリ
            </h3>
            <M3eButton type="button" variant="tonal" onClick={onOpenLibrary}>
              <M3eIcon slot="icon" name="history" />
              開く
            </M3eButton>
          </div>
          <p className="settings-help">
            {syncStatus?.detail || "接続確認中…"}
          </p>
          <M3eButton
            type="button"
            variant="text"
            onClick={() => {
              void (async () => {
                const st = await probeSupabaseSync();
                setSyncStatus(st);
                const ok = await isTagLibraryReady();
                onSnack(ok ? "ライブラリ接続OK" : st.detail);
              })();
            }}
          >
            再確認
          </M3eButton>
        </div>

        <M3eDivider />

        <div className="settings-block">
          <div className="settings-block-head">
            <h3 className="settings-block-title">
              <M3eIcon name="download_done" />
              モデルキャッシュ
            </h3>
            <M3eButton
              type="button"
              variant="text"
              disabled={busy}
              onClick={() => void refresh()}
            >
              更新
            </M3eButton>
          </div>
          <M3eList className="cache-list">
            {caches.map((m) => (
              <M3eListItem key={m.id}>
                <M3eIcon
                  slot="leading"
                  name={m.present ? "check_circle" : "cloud_download"}
                  filled={m.present}
                />
                {m.shortLabel}
                <span slot="supporting-text">
                  {m.present
                    ? `保存済 · ${formatBytes(m.bytes)}${
                        m.savedAt ? ` · ${formatSavedAt(m.savedAt)}` : ""
                      }`
                    : `未取得 · 約${m.expectedMb}MB`}
                </span>
                {m.present ? (
                  <M3eButton
                    slot="trailing"
                    type="button"
                    variant="text"
                    disabled={busy}
                    onClick={() => void removeCache(m.id)}
                  >
                    削除
                  </M3eButton>
                ) : null}
              </M3eListItem>
            ))}
          </M3eList>
          <M3eButton
            type="button"
            variant="outlined"
            disabled={busy || !caches.some((c) => c.present)}
            onClick={() => void clearAll()}
          >
            キャッシュ全削除
          </M3eButton>
        </div>

        <M3eDivider />

        <div className="settings-block">
          <div className="settings-block-head">
            <h3 className="settings-block-title">
              <M3eIcon name="bug_report" />
              診断ログ
            </h3>
            <M3eButton type="button" variant="tonal" onClick={onOpenLog}>
              開く
            </M3eButton>
          </div>
          <p className="settings-help">
            {crash
              ? `前回は${crash.analyzing ? "解析中に" : ""}強制終了しました。`
              : "端末内のみに記録します。"}
            {logCount > 0 ? ` ${logCount} 件。` : ""}
          </p>
        </div>
      </div>

      <div slot="actions" className="dialog-actions">
        <M3eButton type="button" variant="filled" onClick={onClose}>
          閉じる
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
