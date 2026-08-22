/**
 * Pure rules for the Present Mode watermark upload (Settings -> Present
 * Mode Branding): accepted file types, size budgets, and the resize math.
 * Deliberately has no dependency on File/Image/canvas so it's directly
 * unit-testable via tsx - the actual decode/resize/encode pipeline (which
 * needs real browser APIs) lives in processWatermarkUpload.ts and just
 * calls into these.
 */

export const WATERMARK_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Sanity cap on the raw upload before even attempting to decode it - not the persisted size budget. */
export const WATERMARK_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** What actually gets persisted through DataRepository must stay well under typical browser storage limits. */
export const WATERMARK_MAX_DATA_URL_BYTES = 1.5 * 1024 * 1024;

export const WATERMARK_MAX_WIDTH = 1920;
export const WATERMARK_MAX_HEIGHT = 1080;

/** Quality steps tried, in order, if a PNG re-encode doesn't fit the size budget. */
export const WATERMARK_JPEG_QUALITY_STEPS = [0.85, 0.7, 0.55, 0.4] as const;

export function isAcceptedWatermarkMimeType(mimeType: string): boolean {
  return (WATERMARK_ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType);
}

/** Scales `sourceWidth`x`sourceHeight` down to fit within `maxWidth`x`maxHeight`, preserving aspect ratio - never upscales a smaller source image. */
export function computeWatermarkTargetSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/** Approximate decoded byte size of a `data:` URL's base64 payload (ignores the few-byte scheme/mime prefix). */
export function dataUrlByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
