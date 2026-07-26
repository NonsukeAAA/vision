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
import {
  formatBytes,
  getDeviceResourceInfo,
  type DeviceResourceInfo,
} from "./deviceResources";
import {
  clearAllCachedBrowserModels,
  deleteCachedBrowserModel,
  listCachedBrowserModels,
  type CachedModelInfo,
} from "./wdBrowser";
import {
  isGitHubPagesHost,
  type AppSettings,
} from "./types";
import { getLogEntries, getPreviousSessionReport } from "./diagnostics";
type Props = {
  open: boolean;
  settings: AppSettings;
  onChange: (next: AppSettings | ((s: AppSettings) => AppSettings)) => void;
  onClose: () => void;
  /** Opens the drop-tag list, which App renders as its own modal. */
  onEditDropTags: () => void;
  /** Opens the diagnostics log, also an App-level modal. */
  onOpenLog: () => void;
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
  onOpenLog,
  onSnack,
}: Props) {
  const onPages = isGitHubPagesHost();
  const crash = getPreviousSessionReport();
  const logCount = getLogEntries().length;
  const thresholdPercent = Math.round(settings.threshold * 100);
  const [resources, setResources] = useState<DeviceResourceInfo | null>(null);
  const [caches, setCaches] = useState<CachedModelInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [info, models] = await Promise.all([
      getDeviceResourceInfo(),
      listCachedBrowserModels(),
    ]);
    setResources(info);
    setCaches(models);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh, settings.browserModel, settings.ensembleModels.join(",")]);

  const patch = (partial: Partial<AppSettings>) => {
    onChange((s) => ({ ...s, ...partial }));
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

  const usageRatio =
    resources?.storageUsageBytes != null &&
    resources.storageQuotaBytes != null &&
    resources.storageQuotaBytes > 0
      ? Math.min(
          1,
          resources.storageUsageBytes / resources.storageQuotaBytes,
        )
      : null;

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
      {onPages && (
        <p className="settings-banner">
          GitHub Pages では画像を端末内で解析します。JoyCaption は PC で API
          起動後、「ローカル API」を選んでください。
        </p>
      )}

      <div className="settings-block">
        <h3 className="settings-block-title">
          <M3eIcon name="memory" />
          端末リソース
        </h3>
        <div className="resource-grid">
          <div className="resource-card">
            <span className="resource-label">メモリ</span>
            <strong className="resource-value">
              {resources?.deviceMemoryGb != null
                ? `約 ${resources.deviceMemoryGb} GB`
                : "端末依存"}
            </strong>
            <span className="resource-hint">
              {resources?.deviceMemoryGb != null
                ? "navigator.deviceMemory"
                : "Safari は最大数GBヒープまで確保可"}
            </span>
          </div>
          <div className="resource-card">
            <span className="resource-label">空きストレージ</span>
            <strong className="resource-value">
              {formatBytes(resources?.storageFreeBytes)}
            </strong>
            <span className="resource-hint">
              使用 {formatBytes(resources?.storageUsageBytes)} /{" "}
              {formatBytes(resources?.storageQuotaBytes)}
            </span>
          </div>
          <div className="resource-card">
            <span className="resource-label">推論バックエンド</span>
            <strong className="resource-value">
              {resources?.webGpu ? "WebGPU" : "WASM"}
            </strong>
            <span className="resource-hint">
              OPFS {resources?.opfs ? "可" : "不可"}
              {resources?.persisted ? " · 永続化済" : ""}
              {!resources?.webGpu ? " · Pages は WASM" : ""}
            </span>
          </div>
        </div>
        {usageRatio != null && (
          <div
            className="storage-meter"
            role="meter"
            aria-valuenow={Math.round(usageRatio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="ストレージ使用率"
          >
            <div
              className="storage-meter-fill"
              style={{ width: `${Math.round(usageRatio * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="settings-block">
        <div className="settings-block-head">
          <h3 className="settings-block-title">
            <M3eIcon name="download_done" />
            ダウンロード済みモデル
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
                  : `未ダウンロード · 約${m.expectedMb}MB`}
                {m.tagsCached ? " · タグ辞書あり" : ""}
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
              ) : (
                <span slot="trailing" className="cache-badge is-empty">
                  未取得
                </span>
              )}
            </M3eListItem>
          ))}
        </M3eList>
        <div className="settings-actions">
          <M3eButton
            type="button"
            variant="outlined"
            disabled={busy || !caches.some((c) => c.present)}
            onClick={() => void clearAll()}
          >
            <M3eIcon slot="icon" name="delete" />
            キャッシュ全削除
          </M3eButton>
        </div>
      </div>

      <M3eDivider />

      <div className="settings-block">
        <h3 className="settings-block-title">
          <M3eIcon name="tune" />
          推論
        </h3>

        <label className="settings-field">
          <span>推論エンジン</span>
          <select
            value={settings.engine}
            onChange={(e) =>
              patch({ engine: e.target.value as AppSettings["engine"] })
            }
          >
            <option value="browser">ブラウザ (WD/PixAI · Pages対応)</option>
            <option value="local-api">ローカル API (JoyCaption + WD14)</option>
          </select>
        </label>

        {settings.engine === "browser" && (
          <>
            <label className="settings-field">
              <span>実行モード</span>
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
                <span>ブラウザモデル</span>
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
                  同じタグは1つにまとめ、スコアは最大値。複数一致を優先します。
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
          </>
        )}

        {settings.engine === "local-api" && (
          <>
            <p className="settings-help">
              事前に <code>./scripts/dev.sh</code> などで API
              を起動してください。未起動の場合は自動でブラウザ推論に戻ります。
            </p>
            <label className="settings-field">
              <span>API Base URL</span>
              <input
                type="text"
                value={settings.apiBase}
                onChange={(e) => patch({ apiBase: e.target.value })}
              />
            </label>
          </>
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
              const el = e.currentTarget as HTMLElement & { checked?: boolean };
              patch({ includeRating: !!el.checked });
            }}
          />
        </label>

        {settings.engine === "local-api" && (
          <label className="settings-switch">
            <span>JoyCaption を使う</span>
            <M3eSwitch
              checked={settings.enableJoy}
              onChange={(e) => {
                const el = e.currentTarget as HTMLElement & {
                  checked?: boolean;
                };
                patch({ enableJoy: !!el.checked });
              }}
            />
          </label>
        )}
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
          検閲・モノクロ・漫画・構図ノイズ（v / multiple views）は既定で削除します。
          {settings.dropTags.length > 0
            ? `追加で ${settings.dropTags.length} 件を削除中: ${settings.dropTags
                .slice(0, 6)
                .join(", ")}${settings.dropTags.length > 6 ? " …" : ""}`
            : "追加のタグは未登録です。"}
        </p>
      </div>

      <M3eDivider />

      <div className="settings-block">
        <div className="settings-block-head">
          <h3 className="settings-block-title">
            <M3eIcon name="bug_report" />
            診断ログ
          </h3>
          <M3eButton type="button" variant="tonal" onClick={onOpenLog}>
            <M3eIcon slot="icon" name="receipt_long" />
            開く
          </M3eButton>
        </div>
        <p className="settings-help">
          {crash
            ? `前回は${crash.analyzing ? "解析中に" : ""}強制終了しました（最後の記録: ${crash.lastMsg || "不明"}）。`
            : "解析の各段階を端末内だけに記録します。落ちた時の直前の処理が分かります。"}
          {logCount > 0 ? ` 現在 ${logCount} 件。` : ""}
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
