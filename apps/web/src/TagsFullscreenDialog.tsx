import { useEffect, useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eDialog } from "@m3e/react/dialog";
import { M3eIcon } from "@m3e/react/icon";
import { TagChipList } from "./TagChipList";
import type { TagScore } from "./types";

type Props = {
  open: boolean;
  tags: TagScore[];
  votes: Record<string, number>;
  showJa: boolean;
  customJa: Record<string, string>;
  canUndo: boolean;
  onRemove: (tag: string) => void;
  onEditJa?: (tag: string, currentJa: string | null) => void;
  onUndo: () => void;
  onCopy: () => void;
  onClose: () => void;
  copied?: boolean;
};

export function TagsFullscreenDialog({
  open,
  tags,
  votes,
  showJa,
  customJa,
  canUndo,
  onRemove,
  onEditJa,
  onUndo,
  onCopy,
  onClose,
  copied = false,
}: Props) {
  const [pressing, setPressing] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setPressing(null);
  }, [open]);

  return (
    <M3eDialog
      className="tags-fullscreen-dialog"
      open={open}
      dismissible
      closeLabel="閉じる"
      onClosed={onClose}
      onCancel={onClose}
    >
      <span slot="header">タグ一覧</span>

      <div className="tags-fs-body">
        <div className="tags-fs-toolbar">
          <span className="muted">
            {tags.length} tags · タップで訳編集 · 2秒長押しで削除
            {pressing ? ` · 「${pressing}」…` : ""}
          </span>
          <div className="tags-fs-actions">
            <M3eButton
              type="button"
              variant="tonal"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <M3eIcon slot="icon" name="undo" />
              戻す
            </M3eButton>
            <M3eButton
              type="button"
              variant="filled"
              disabled={tags.length === 0}
              onClick={onCopy}
            >
              <M3eIcon slot="icon" name="content_copy" />
              {copied ? "コピー済み" : "コピー"}
            </M3eButton>
          </div>
        </div>

        <TagChipList
          className="chip-wrap chip-wrap-fullscreen"
          tags={tags}
          votes={votes}
          showJa={showJa}
          customJa={customJa}
          onRemove={onRemove}
          onEditJa={onEditJa}
          onPressingChange={setPressing}
        />
      </div>
    </M3eDialog>
  );
}
