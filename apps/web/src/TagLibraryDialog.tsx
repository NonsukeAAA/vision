import { useEffect, useMemo, useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eDialog } from "@m3e/react/dialog";
import { M3eIcon } from "@m3e/react/icon";
import {
  addFavorite,
  deleteDictEntry,
  deleteHistory,
  exportLibrary,
  importLibrary,
  isFavorite,
  listDictionary,
  listFavorites,
  listHistory,
  removeFavorite,
  upsertDictEntry,
  type DictEntry,
  type TagSetRecord,
} from "./tagLibrary";
import { translateTag } from "./tagJa";

type Tab = "history" | "favorites" | "dictionary";

type Props = {
  open: boolean;
  onClose: () => void;
  onLoadSet: (record: TagSetRecord) => void;
  onNotify?: (message: string) => void;
  /** Refresh custom JA map in the parent after dictionary edits. */
  onDictChanged?: () => void;
};

function formatWhen(ts: number): string {
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

export function TagLibraryDialog({
  open,
  onClose,
  onLoadSet,
  onNotify,
  onDictChanged,
}: Props) {
  const [tab, setTab] = useState<Tab>("history");
  const [history, setHistory] = useState<TagSetRecord[]>([]);
  const [favorites, setFavorites] = useState<TagSetRecord[]>([]);
  const [dict, setDict] = useState<DictEntry[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [editTag, setEditTag] = useState<DictEntry | null>(null);
  const [editJa, setEditJa] = useState("");
  const [editNote, setEditNote] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [h, f, d] = await Promise.all([
      listHistory(),
      listFavorites(),
      listDictionary(),
    ]);
    setHistory(h);
    setFavorites(f);
    setDict(d);
    setFavIds(new Set(f.map((x) => x.id)));
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setEditTag(null);
    void reload();
  }, [open]);

  const filteredDict = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dict;
    return dict.filter(
      (e) =>
        e.tag.includes(q) ||
        e.customJa.toLowerCase().includes(q) ||
        e.note.toLowerCase().includes(q) ||
        (translateTag(e.tag) ?? "").includes(q),
    );
  }, [dict, query]);

  const toggleFavorite = async (record: TagSetRecord) => {
    setBusy(true);
    try {
      if (await isFavorite(record.id)) {
        await removeFavorite(record.id);
        onNotify?.("お気に入りを解除しました");
      } else {
        await addFavorite(record);
        onNotify?.("お気に入りに追加しました");
      }
      await reload();
    } catch {
      onNotify?.("お気に入りの更新に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const load = (record: TagSetRecord) => {
    onLoadSet(record);
    onNotify?.("タグセットを読み込みました");
    onClose();
  };

  const startEdit = (entry: DictEntry) => {
    setEditTag(entry);
    setEditJa(entry.customJa);
    setEditNote(entry.note);
  };

  const saveEdit = async () => {
    if (!editTag) return;
    setBusy(true);
    try {
      await upsertDictEntry({
        tag: editTag.tag,
        customJa: editJa.trim(),
        note: editNote.trim(),
      });
      setEditTag(null);
      await reload();
      onDictChanged?.();
      onNotify?.("辞書を更新しました");
    } catch {
      onNotify?.("辞書の保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const removeDict = async (tag: string) => {
    setBusy(true);
    try {
      await deleteDictEntry(tag);
      if (editTag?.tag === tag) setEditTag(null);
      await reload();
      onDictChanged?.();
      onNotify?.("辞書から削除しました");
    } catch {
      onNotify?.("削除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const doExport = async () => {
    try {
      const data = await exportLibrary();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vision-tag-library-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify?.("バックアップをダウンロードしました");
    } catch {
      onNotify?.("エクスポートに失敗しました");
    }
  };

  const doImport = async (file: File, mode: "merge" | "replace") => {
    setBusy(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importLibrary(data, mode);
      await reload();
      onDictChanged?.();
      onNotify?.(
        mode === "replace"
          ? "ライブラリを置き換えました"
          : "ライブラリを取り込みました",
      );
    } catch {
      onNotify?.("インポートに失敗しました（JSON を確認してください）");
    } finally {
      setBusy(false);
    }
  };

  const renderSetList = (rows: TagSetRecord[], empty: string) => {
    if (rows.length === 0) {
      return <p className="settings-help">{empty}</p>;
    }
    return (
      <ul className="tag-lib-list">
        {rows.map((row) => {
          const starred = favIds.has(row.id);
          return (
            <li key={row.id} className="tag-lib-item">
              <button
                type="button"
                className="tag-lib-main"
                onClick={() => load(row)}
              >
                <strong>{row.label || "タグセット"}</strong>
                <span className="muted">
                  {formatWhen(row.createdAt)} · {row.tags.length} tags
                  {row.imageName ? ` · ${row.imageName}` : ""}
                </span>
                <span className="tag-lib-preview">
                  {row.tags
                    .slice(0, 8)
                    .map((t) => t.tag)
                    .join(", ")}
                </span>
              </button>
              <div className="tag-lib-item-actions">
                <button
                  type="button"
                  className="btn-text"
                  disabled={busy}
                  title={starred ? "お気に入り解除" : "お気に入り"}
                  onClick={() => void toggleFavorite(row)}
                >
                  {starred ? "★" : "☆"}
                </button>
                {tab === "history" && (
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() =>
                      void deleteHistory(row.id).then(() => reload())
                    }
                  >
                    削除
                  </button>
                )}
                {tab === "favorites" && (
                  <button
                    type="button"
                    className="btn-text"
                    disabled={busy}
                    onClick={() =>
                      void removeFavorite(row.id).then(() => reload())
                    }
                  >
                    解除
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <M3eDialog
      className="tag-library-dialog"
      open={open}
      dismissible
      closeLabel="閉じる"
      onClosed={onClose}
      onCancel={onClose}
    >
      <span slot="header">タグライブラリ</span>

      <div className="tag-lib-body">
        <p className="settings-help">
          データはすべて Supabase（vision_tag_sets /
          vision_tag_dictionary）に保存されています。バックアップ JSON
          のエクスポート／インポートもできます。
        </p>

        <div className="tag-lib-tabs" role="tablist">
          {(
            [
              ["history", "履歴"],
              ["favorites", "お気に入り"],
              ["dictionary", "辞書"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="mode-btn"
              aria-selected={tab === id}
              aria-checked={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "history" &&
          renderSetList(history, "まだ履歴がありません。画像を解析すると直近100件まで残ります。")}
        {tab === "favorites" &&
          renderSetList(favorites, "お気に入りはまだありません。履歴の☆から追加できます。")}

        {tab === "dictionary" && (
          <div className="tag-lib-dict">
            <input
              type="search"
              className="tag-lib-search"
              placeholder="タグ・訳・メモで検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p className="settings-help">
              これまでに生成したタグ {dict.length} 件。日本語訳やメモを編集できます。
            </p>
            {editTag ? (
              <div className="tag-lib-edit">
                <strong>{editTag.tag}</strong>
                <label>
                  日本語訳（任意）
                  <input
                    type="text"
                    value={editJa}
                    onChange={(e) => setEditJa(e.target.value)}
                    placeholder={translateTag(editTag.tag) ?? ""}
                  />
                </label>
                <label>
                  メモ
                  <input
                    type="text"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                  />
                </label>
                <div className="tag-lib-edit-actions">
                  <M3eButton
                    type="button"
                    variant="filled"
                    disabled={busy}
                    onClick={() => void saveEdit()}
                  >
                    保存
                  </M3eButton>
                  <M3eButton
                    type="button"
                    variant="tonal"
                    onClick={() => setEditTag(null)}
                  >
                    キャンセル
                  </M3eButton>
                  <M3eButton
                    type="button"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => void removeDict(editTag.tag)}
                  >
                    削除
                  </M3eButton>
                </div>
              </div>
            ) : (
              <ul className="tag-lib-list tag-lib-dict-list">
                {filteredDict.slice(0, 200).map((entry) => {
                  const gloss =
                    entry.customJa.trim() || translateTag(entry.tag) || "";
                  return (
                    <li key={entry.tag} className="tag-lib-item">
                      <button
                        type="button"
                        className="tag-lib-main"
                        onClick={() => startEdit(entry)}
                      >
                        <strong>{entry.tag}</strong>
                        <span className="muted">
                          {gloss || "訳なし"} · ×{entry.count}
                          {entry.note ? ` · ${entry.note}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="tag-lib-backup">
          <M3eButton type="button" variant="tonal" onClick={() => void doExport()}>
            <M3eIcon slot="icon" name="download" />
            エクスポート
          </M3eButton>
          <label className="tag-lib-import">
            <span>取り込み（マージ）</span>
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void doImport(f, "merge");
              }}
            />
          </label>
          <label className="tag-lib-import">
            <span>置き換え</span>
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (
                  f &&
                  window.confirm(
                    "現在の履歴・お気に入り・辞書をすべて置き換えます。よろしいですか？",
                  )
                ) {
                  void doImport(f, "replace");
                }
              }}
            />
          </label>
        </div>
      </div>
    </M3eDialog>
  );
}
