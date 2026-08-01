import { forcedPrefixTags, normalizeTag } from "./forceUncensored";
import { resolveTagJa } from "./tagJa";
import type { TagScore } from "./types";
import { useLongPress } from "./useLongPress";

type Props = {
  tags: TagScore[];
  votes?: Record<string, number>;
  showJa?: boolean;
  customJa?: Record<string, string>;
  /** Fires after a successful 2s long-press on a non-locked chip. */
  onRemove: (tag: string) => void;
  /** Short tap: edit / save Japanese gloss into the dictionary. */
  onEditJa?: (tag: string, currentJa: string | null) => void;
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
  onEditJa,
  onPressingChange,
}: {
  tag: string;
  score: number;
  locked: boolean;
  vote?: number;
  ja: string | null;
  onRemove: (tag: string) => void;
  onEditJa?: (tag: string, currentJa: string | null) => void;
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
      className={`tag-chip ${locked ? "tag-locked" : ""} ${ja ? "has-ja" : ""}`}
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
      onClick={() => {
        if (!onEditJa) return;
        onEditJa(tag, ja);
      }}
      title={
        locked
          ? "設定の挿入タグから変更できます"
          : onEditJa
            ? "タップで日本語訳を編集 · 2秒長押しで削除"
            : vote && vote > 1
              ? `${vote}モデルが一致 · 2秒長押しで削除`
              : "2秒長押しで削除"
      }
      aria-label={
        locked
          ? `${ja || tag}（固定）`
          : `${ja || tag}（タップで訳を編集、2秒長押しで削除）`
      }
    >
      <span className="tag-chip-main">
        {ja ? <span className="tag-ja">{ja}</span> : null}
        <span className="tag-en">{tag}</span>
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
  onEditJa,
  onPressingChange,
  className = "chip-wrap",
}: Props) {
  const lockedSet = new Set(forcedPrefixTags());

  return (
    <div className={className}>
      {tags.map((t) => {
        const key = normalizeTag(t.tag);
        const locked = lockedSet.has(key);
        const ja = showJa ? resolveTagJa(t.tag, customJa) : null;
        return (
          <ChipButton
            key={t.tag}
            tag={t.tag}
            score={t.score}
            locked={locked}
            vote={votes[t.tag]}
            ja={ja}
            onRemove={onRemove}
            onEditJa={onEditJa}
            onPressingChange={onPressingChange}
          />
        );
      })}
    </div>
  );
}
