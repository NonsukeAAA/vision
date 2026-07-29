import { useEffect, useRef, useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eChipSet } from "@m3e/react/chips";
import { M3eInputChip } from "@m3e/react/chips";
import { M3eSuggestionChip } from "@m3e/react/chips";
import { M3eDialog } from "@m3e/react/dialog";
import { M3eIcon } from "@m3e/react/icon";
import { normalizeTag, QUALITY_INSERT_TAGS } from "./forceUncensored";

type Props = {
  open: boolean;
  tags: string[];
  qualityEnabled: boolean;
  onChange: (next: string[]) => void;
  onClose: () => void;
};

/** Extra quality / style boosters offered as one-tap additions. */
const SUGGESTIONS = [
  "newest",
  "amazing quality",
  "very aesthetic",
  "intricate details",
  "anime coloring",
  "illustration",
  "detailed",
  "sharp focus",
  "vibrant colors",
  "beautiful lighting",
];

export function InsertTagsDialog({
  open,
  tags,
  qualityEnabled,
  onChange,
  onClose,
}: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setDraft("");
  }, [open]);

  const add = (raw: string) => {
    const incoming = raw
      .split(/[,\n]/)
      .map((t) => normalizeTag(t))
      .filter(Boolean);
    if (incoming.length === 0) return;
    const next = [...tags];
    for (const tag of incoming) {
      if (!next.includes(tag)) next.push(tag);
    }
    onChange(next);
    setDraft("");
    inputRef.current?.focus();
  };

  const remove = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <M3eDialog
      className="drop-tags-dialog"
      open={open}
      dismissible
      closeLabel="閉じる"
      onClosed={onClose}
      onCancel={onClose}
    >
      <span slot="header">挿入タグリスト</span>

      <div className="drop-tags-body">
        <p className="settings-help">
          ここに入れたタグは解析結果とプロンプトの先頭付近に自動で入ります。
          大文字・アンダースコアは区別しません。
        </p>

        <form
          className="drop-tags-form"
          onSubmit={(e) => {
            e.preventDefault();
            add(draft);
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={draft}
            placeholder="例: detailed, anime coloring"
            aria-label="挿入するタグ"
            onChange={(e) => setDraft(e.target.value)}
          />
          <M3eButton type="submit" variant="filled" disabled={!draft.trim()}>
            <M3eIcon slot="icon" name="add" />
            追加
          </M3eButton>
        </form>

        <div className="drop-tags-section">
          <h4 className="drop-tags-label">
            自分で追加したタグ
            <span className="drop-tags-count">{tags.length}</span>
          </h4>
          {tags.length === 0 ? (
            <p className="settings-help">まだありません。</p>
          ) : (
            <M3eChipSet className="drop-tags-chips">
              {tags.map((tag) => (
                <M3eInputChip
                  key={tag}
                  removable
                  removeLabel={`${tag} を削除`}
                  onRemove={() => remove(tag)}
                >
                  {tag}
                </M3eInputChip>
              ))}
            </M3eChipSet>
          )}
        </div>

        <div className="drop-tags-section">
          <h4 className="drop-tags-label">よく入れるタグ</h4>
          <M3eChipSet className="drop-tags-chips">
            {SUGGESTIONS.filter((s) => !tags.includes(s)).map((tag) => (
              <M3eSuggestionChip key={tag} onClick={() => add(tag)}>
                <M3eIcon slot="icon" name="add" />
                {tag}
              </M3eSuggestionChip>
            ))}
          </M3eChipSet>
        </div>

        <div className="drop-tags-section">
          <h4 className="drop-tags-label">最初から入るタグ</h4>
          <ul className="drop-tags-rules">
            <li>
              <M3eIcon name="verified" />
              <span>
                <strong>uncensored</strong>
                <em>常に先頭に固定</em>
              </span>
            </li>
            <li>
              <M3eIcon name={qualityEnabled ? "auto_awesome" : "block"} />
              <span>
                <strong>画質アップ（イラスト）</strong>
                <em>
                  {qualityEnabled
                    ? QUALITY_INSERT_TAGS.join(", ")
                    : "設定でオフになっています"}
                </em>
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div slot="actions" className="dialog-actions">
        <M3eButton
          type="button"
          variant="text"
          disabled={tags.length === 0}
          onClick={() => onChange([])}
        >
          すべて削除
        </M3eButton>
        <M3eButton type="button" variant="filled" onClick={onClose}>
          完了
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
