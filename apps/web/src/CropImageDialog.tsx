import { useEffect, useRef, useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eDialog } from "@m3e/react/dialog";
import { M3eIcon } from "@m3e/react/icon";

type Rect = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "ne" | "sw" | "se";

type Props = {
  open: boolean;
  file: File | null;
  onClose: () => void;
  onCropped: (file: File) => void;
  onError?: (message: string) => void;
};

type DragMode =
  | { kind: "move"; startX: number; startY: number; origin: Rect }
  | {
      kind: "resize";
      handle: Handle;
      startX: number;
      startY: number;
      origin: Rect;
    };

const MIN_CROP = 32;

function clampCrop(next: Rect, nw: number, nh: number): Rect {
  let { x, y, w, h } = next;
  w = Math.max(MIN_CROP, Math.min(w, nw));
  h = Math.max(MIN_CROP, Math.min(h, nh));
  x = Math.min(Math.max(0, x), nw - w);
  y = Math.min(Math.max(0, y), nh - h);
  return { x, y, w, h };
}

export function CropImageDialog({
  open,
  file,
  onClose,
  onCropped,
  onError,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [display, setDisplay] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<DragMode | null>(null);

  useEffect(() => {
    if (!open || !file) {
      setUrl(null);
      setNatural({ w: 0, h: 0 });
      setDisplay({ w: 0, h: 0 });
      setCrop({ x: 0, y: 0, w: 0, h: 0 });
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [open, file]);

  const measureDisplay = () => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setDisplay({ w: rect.width, h: rect.height });
  };

  const onImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNatural({ w, h });
    const margin = 0.05;
    setCrop(
      clampCrop(
        {
          x: w * margin,
          y: h * margin,
          w: w * (1 - margin * 2),
          h: h * (1 - margin * 2),
        },
        w,
        h,
      ),
    );
    measureDisplay();
  };

  useEffect(() => {
    if (!open) return;
    const onResize = () => measureDisplay();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const clientToNatural = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img || !natural.w) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    const scaleX = natural.w / rect.width;
    const scaleY = natural.h / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const beginDrag = (
    e: React.PointerEvent<HTMLElement>,
    mode: "move" | "resize",
    handle?: Handle,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = clientToNatural(e.clientX, e.clientY);
    if (mode === "move") {
      dragRef.current = {
        kind: "move",
        startX: pt.x,
        startY: pt.y,
        origin: crop,
      };
      return;
    }
    if (!handle) return;
    dragRef.current = {
      kind: "resize",
      handle,
      startX: pt.x,
      startY: pt.y,
      origin: crop,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !natural.w) return;
    const pt = clientToNatural(e.clientX, e.clientY);
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    const o = drag.origin;
    if (drag.kind === "move") {
      setCrop(
        clampCrop({ ...o, x: o.x + dx, y: o.y + dy }, natural.w, natural.h),
      );
      return;
    }
    let { x, y, w, h } = o;
    switch (drag.handle) {
      case "nw":
        x = o.x + dx;
        y = o.y + dy;
        w = o.w - dx;
        h = o.h - dy;
        break;
      case "ne":
        y = o.y + dy;
        w = o.w + dx;
        h = o.h - dy;
        break;
      case "sw":
        x = o.x + dx;
        w = o.w - dx;
        h = o.h + dy;
        break;
      case "se":
        w = o.w + dx;
        h = o.h + dy;
        break;
    }
    setCrop(clampCrop({ x, y, w, h }, natural.w, natural.h));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const applyCrop = async () => {
    if (!file || !natural.w || crop.w < 1 || crop.h < 1) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const tw = Math.max(1, Math.round(crop.w));
      const th = Math.max(1, Math.round(crop.h));
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(
        bitmap,
        Math.round(crop.x),
        Math.round(crop.y),
        tw,
        th,
        0,
        0,
        tw,
        th,
      );
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) throw new Error("export failed");
      const base = file.name.replace(/\.[^.]+$/, "") || "image";
      onCropped(
        new File([blob], `${base}-crop.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        }),
      );
      onClose();
    } catch (err) {
      onError?.(
        err instanceof Error ? err.message : "クロップに失敗しました",
      );
    } finally {
      setBusy(false);
    }
  };

  const scaleX = display.w > 0 && natural.w > 0 ? display.w / natural.w : 0;
  const scaleY = display.h > 0 && natural.h > 0 ? display.h / natural.h : 0;

  return (
    <M3eDialog
      className="crop-dialog"
      open={open}
      dismissible={!busy}
      closeLabel="閉じる"
      onClosed={onClose}
      onCancel={onClose}
    >
      <span slot="header">画像をクロップ</span>
      <div className="crop-body">
        <p className="settings-help">
          枠をドラッグして範囲を決め、「適用」で切り取ります。端末への保存と解析はこの結果を使います。
        </p>
        <div
          className="crop-stage"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && (
            <img
              ref={imgRef}
              src={url}
              alt="クロップ対象"
              className="crop-image"
              draggable={false}
              onLoad={onImageLoad}
            />
          )}
          {scaleX > 0 && crop.w > 0 && (
            <div
              className="crop-box"
              style={{
                left: crop.x * scaleX,
                top: crop.y * scaleY,
                width: crop.w * scaleX,
                height: crop.h * scaleY,
              }}
              onPointerDown={(e) => beginDrag(e, "move")}
            >
              {(["nw", "ne", "sw", "se"] as const).map((handle) => (
                <span
                  key={handle}
                  className={`crop-handle crop-handle-${handle}`}
                  onPointerDown={(e) => beginDrag(e, "resize", handle)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div slot="actions" className="dialog-actions">
        <M3eButton type="button" variant="text" disabled={busy} onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          type="button"
          variant="filled"
          disabled={busy || !file || crop.w < 1}
          onClick={() => void applyCrop()}
        >
          <M3eIcon slot="icon" name="crop" />
          {busy ? "処理中…" : "適用"}
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
