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

type DragMode = {
  kind: "move" | "resize";
  handle?: Handle;
  startX: number;
  startY: number;
  origin: Rect;
};

const MIN_CROP = 24;

function clampCrop(next: Rect, nw: number, nh: number): Rect {
  let { x, y, w, h } = next;
  w = Math.max(MIN_CROP, Math.min(w, nw));
  h = Math.max(MIN_CROP, Math.min(h, nh));
  x = Math.min(Math.max(0, x), nw - w);
  y = Math.min(Math.max(0, y), nh - h);
  return { x, y, w, h };
}

async function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  return img;
}

export function CropImageDialog({
  open,
  file,
  onClose,
  onCropped,
  onError,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const cropRef = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [layout, setLayout] = useState({ left: 0, top: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<DragMode | null>(null);

  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);

  useEffect(() => {
    if (!open || !file) {
      setUrl(null);
      setNatural({ w: 0, h: 0 });
      setLayout({ left: 0, top: 0, w: 0, h: 0 });
      setCrop({ x: 0, y: 0, w: 0, h: 0 });
      dragRef.current = null;
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [open, file]);

  const syncLayout = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const rect = img.getBoundingClientRect();
    const stage = img.parentElement?.getBoundingClientRect();
    if (!stage) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setLayout({
      left: rect.left - stage.left,
      top: rect.top - stage.top,
      w: rect.width,
      h: rect.height,
    });
  };

  const onImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNatural({ w, h });
    const margin = 0.08;
    const next = clampCrop(
      {
        x: w * margin,
        y: h * margin,
        w: w * (1 - margin * 2),
        h: h * (1 - margin * 2),
      },
      w,
      h,
    );
    setCrop(next);
    cropRef.current = next;
    requestAnimationFrame(() => syncLayout());
  };

  useEffect(() => {
    if (!open) return;
    const onResize = () => syncLayout();
    window.addEventListener("resize", onResize);
    const id = window.setInterval(syncLayout, 400);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearInterval(id);
    };
  }, [open, url]);

  const clientToNatural = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img || !natural.w || layout.w <= 0) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * natural.w,
      y: ((clientY - rect.top) / rect.height) * natural.h,
    };
  };

  const beginDrag = (
    e: React.PointerEvent<HTMLElement>,
    kind: "move" | "resize",
    handle?: Handle,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const pt = clientToNatural(e.clientX, e.clientY);
    dragRef.current = {
      kind,
      handle,
      startX: pt.x,
      startY: pt.y,
      origin: { ...cropRef.current },
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !natural.w) return;
    e.preventDefault();
    const pt = clientToNatural(e.clientX, e.clientY);
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    const o = drag.origin;
    let next: Rect;
    if (drag.kind === "move") {
      next = { ...o, x: o.x + dx, y: o.y + dy };
    } else {
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
        default:
          w = o.w + dx;
          h = o.h + dy;
          break;
      }
      next = { x, y, w, h };
    }
    const clamped = clampCrop(next, natural.w, natural.h);
    cropRef.current = clamped;
    setCrop(clamped);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const applyCrop = async () => {
    const current = cropRef.current;
    if (!file || !url || !natural.w || current.w < 1 || current.h < 1) return;
    setBusy(true);
    try {
      const source = await loadHtmlImage(url);
      const canvas = document.createElement("canvas");
      const tw = Math.max(1, Math.round(current.w));
      const th = Math.max(1, Math.round(current.h));
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(
        source,
        Math.round(current.x),
        Math.round(current.y),
        tw,
        th,
        0,
        0,
        tw,
        th,
      );
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

  const scaleX = layout.w > 0 && natural.w > 0 ? layout.w / natural.w : 0;
  const scaleY = layout.h > 0 && natural.h > 0 ? layout.h / natural.h : 0;
  const ready = scaleX > 0 && crop.w > 0;

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
          白い枠を動かして範囲を決め、「適用」で切り取ります。
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
          {ready && (
            <div
              className="crop-box"
              style={{
                left: layout.left + crop.x * scaleX,
                top: layout.top + crop.y * scaleY,
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
          disabled={busy || !ready}
          onClick={() => void applyCrop()}
        >
          <M3eIcon slot="icon" name="check" />
          {busy ? "処理中…" : "適用"}
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
