import { forcedPrefixTags } from "./forceUncensored";
import { translateTag } from "./tagJa";
import type { TagScore } from "./types";
import { useLongPress } from "./useLongPress";

type Props = {
  tags: TagScore[];
  votes?: Record<string, number>;
  showJa?: boolean;
  customJa?: Record<string, string>;
  /** Fires after a successful 2s long-press on a non-locked chip. */
  onRemove: (tag: string) => void;
  onPressingChange?: (tag: string | null) => void;
  className?: string;
};

function ChipButton({
  tag,
  score,
  locked,
  vote,
  ja,
  onRemove,
  onPressingChange,
}: {
  tag: string;
  score: number;
  locked: boolean;
  vote?: number;
  ja: string | null;
  onRemove: (tag: string) => void;
  onPressingChange?: (tag: string | null) => void;
}) {
  const handlers = useLongPress({
    delayMs: 2000,
    disabled: locked,
    onLongPress: () => {
      onPressingChange?.(null);
      onRemove(tag);
    },
  });

  return (
    <button
      type="button"
      className={`tag-chip ${locked ? "tag-locked" : ""}`}
      {...handlers}
      onPointerDown={(e) => {
        if (!locked) onPressingChange?.(tag);
        handlers.onPointerDown(e);
      }}
      onPointerUp={(e) => {
        onPressingChange?.(null);
        handlers.onPointerUp();
        void e;
      }}
      onPointerLeave={() => {
        onPressingChange?.(null);
        handlers.onPointerLeave();
      }}
      onPointerCancel={() => {
        onPressingChange?.(null);
        handlers.onPointerCancel();
      }}
      title={
        locked
          ? "設定の挿入タグから変更できます"
          : vote && vote > 1
            ? `${vote}モデルが一致 · 2秒長押しで削除`
            : "2秒長押しで削除"
      }
      aria-label={
        locked ? `${tag}（固定）` : `${tag}（2秒長押しで削除）`
      }
    >
      <span className="tag-chip-main">
        <span className="tag-en">{tag}</span>
        {ja ? <span className="tag-ja">{ja}</span> : null}
      </span>
      {vote && vote > 1 ? <span className="vote">×{vote}</span> : null}
      <span className="score">{score.toFixed(2)}</span>
    </button>
  );
}

export function TagChipList({
  tags,
  votes = {},
  showJa = false,
  customJa = {},
  onRemove,
  onPressingChange,
  className = "chip-wrap",
}: Props) {
  const lockedSet = new Set(forcedPrefixTags());

  return (
    <div className={className}>
      {tags.map((t) => {
        const key = t.tag.trim().toLowerCase().replaceAll("_", " ");
        const locked = lockedSet.has(key);
        const ja = showJa
          ? customJa[key] || customJa[t.tag] || translateTag(t.tag)
          : null;
        return (
          <ChipButton
            key={t.tag}
            tag={t.tag}
            score={t.score}
            locked={locked}
            vote={votes[t.tag]}
            ja={ja}
            onRemove={onRemove}
            onPressingChange={onPressingChange}
          />
        );
      })}
    </div>
  );
}
