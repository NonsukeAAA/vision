/**
 * Image decoding and canvas scratch space.
 *
 * Both live here because mobile Safari is strict about the two: it rejects
 * `createImageBitmap` for freshly picked photos, and it holds on to canvas
 * backing stores, so repeated analyses must not each allocate their own canvas.
 */

export type Drawable = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

/**
 * Decode a picked file for drawing.
 *
 * Safari fails `createImageBitmap` for a freshly picked photo often enough that the
 * first analyze of every new image used to error out, so fall back to an `<img>`,
 * which decodes the same file reliably.
 */
export async function loadDrawable(file: Blob): Promise<Drawable> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () =>
          reject(new Error("画像を読み込めませんでした（形式を確認してください）"));
      });
      if (typeof img.decode === "function") {
        try {
          await img.decode();
        } catch {
          // onload already guarantees dimensions; decode is best-effort
        }
      }
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }
}

let scratch: HTMLCanvasElement | null = null;

/** One canvas for every decode/resize, sized on demand. */
export function scratchContext(
  width: number,
  height: number,
): CanvasRenderingContext2D {
  if (!scratch) scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D コンテキストを取得できませんでした");
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/** Shrink the shared backing store; Safari counts it against the tab until then. */
export function releaseScratch(): void {
  if (!scratch) return;
  scratch.width = 1;
  scratch.height = 1;
}

/**
 * Long edge kept for analysis. Models see 448px, so this only preserves a little
 * headroom for the resize while keeping a phone photo from being decoded at 12MP
 * on every run.
 */
const MAX_ANALYSIS_EDGE = 1280;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Downscale a picked image once, so each analysis decodes a small file.
 * Returns the original when it is already small or when re-encoding fails.
 */
export async function downscaleImageFile(file: File): Promise<File> {
  let image: Drawable;
  try {
    image = await loadDrawable(file);
  } catch {
    return file;
  }
  try {
    const longEdge = Math.max(image.width, image.height);
    if (longEdge <= MAX_ANALYSIS_EDGE) return file;
    const scale = MAX_ANALYSIS_EDGE / longEdge;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const ctx = scratchContext(width, height);
    // JPEG has no alpha; white matches how WD pads its square input.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source, 0, 0, width, height);
    const blob = await canvasToBlob(ctx.canvas, "image/jpeg", 0.92);
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${name}.jpg`, {
      type: blob.type || "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    image.release();
    releaseScratch();
  }
}
