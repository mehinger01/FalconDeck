import {
  WATERMARK_JPEG_QUALITY_STEPS,
  WATERMARK_MAX_DATA_URL_BYTES,
  WATERMARK_MAX_HEIGHT,
  WATERMARK_MAX_UPLOAD_BYTES,
  WATERMARK_MAX_WIDTH,
  computeWatermarkTargetSize,
  dataUrlByteLength,
  isAcceptedWatermarkMimeType,
} from "./watermarkImage";

export type WatermarkUploadResult = { ok: true; dataUrl: string } | { ok: false; error: string };

/**
 * Browser-only: decodes an uploaded watermark image, resizes it to fit a
 * 1920x1080 box (preserving aspect ratio, never upscaling), and re-encodes
 * it as a `data:` URL under a persisted-size budget - falling back to
 * smaller dimensions and then lower JPEG quality if the first pass is too
 * large. Never touches DataRepository itself; the caller (Settings) is
 * responsible for persisting the returned data URL.
 */
export async function processWatermarkUpload(file: File): Promise<WatermarkUploadResult> {
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (!isAcceptedWatermarkMimeType(file.type)) {
    return { ok: false, error: "Unsupported file type. Use PNG, JPG, or WebP." };
  }
  if (file.size > WATERMARK_MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That image is too large to upload (20MB max before resizing)." };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, error: "Couldn't read that image - it may be corrupted or an unsupported format." };
  }

  try {
    const full = encodeBitmapWithinBudget(bitmap, WATERMARK_MAX_WIDTH, WATERMARK_MAX_HEIGHT);
    if (full) return { ok: true, dataUrl: full };

    // Still over budget - halve the target dimensions once more before giving up.
    const halved = encodeBitmapWithinBudget(bitmap, WATERMARK_MAX_WIDTH / 2, WATERMARK_MAX_HEIGHT / 2);
    if (halved) return { ok: true, dataUrl: halved };

    return { ok: false, error: "That image is too large even after compression. Try a smaller or simpler image." };
  } finally {
    bitmap.close();
  }
}

function encodeBitmapWithinBudget(bitmap: ImageBitmap, maxWidth: number, maxHeight: number): string | null {
  const { width, height } = computeWatermarkTargetSize(bitmap.width, bitmap.height, maxWidth, maxHeight);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);

  // PNG first - keeps transparency, which matters for a logo-style watermark.
  const png = canvas.toDataURL("image/png");
  if (dataUrlByteLength(png) <= WATERMARK_MAX_DATA_URL_BYTES) return png;

  // Too large as PNG - fall back to JPEG (loses transparency) at decreasing quality.
  for (const quality of WATERMARK_JPEG_QUALITY_STEPS) {
    const jpeg = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlByteLength(jpeg) <= WATERMARK_MAX_DATA_URL_BYTES) return jpeg;
  }

  return null;
}
