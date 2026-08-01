import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

type Options = {
  /** Hold duration in ms before firing. */
  delayMs?: number;
  onLongPress: () => void;
  disabled?: boolean;
};

/**
 * 2s (default) press-and-hold. Cancels on early release / leave / cancel.
 * Suppresses the subsequent click so a completed long-press does not double-fire.
 */
export function useLongPress({
  delayMs = 2000,
  onLongPress,
  disabled = false,
}: Options) {
  const timerRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (disabled) return;
      if (e.button != null && e.button !== 0) return;
      firedRef.current = false;
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        firedRef.current = true;
        try {
          navigator.vibrate?.(12);
        } catch {
          /* ignore */
        }
        onLongPressRef.current();
      }, delayMs);
    },
    [clear, delayMs, disabled],
  );

  const onPointerUp = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerLeave = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerCancel = useCallback(() => {
    clear();
  }, [clear]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (firedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      firedRef.current = false;
    }
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Avoid the OS context menu fighting the long-press gesture on touch.
    e.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
    onClickCapture,
    onContextMenu,
  };
}
