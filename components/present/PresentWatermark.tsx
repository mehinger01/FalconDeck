import { useState } from "react";
import Image from "next/image";

const DEFAULT_WATERMARK_SRC = "/branding/ohhs-falcon-head.png";

/**
 * Decorative Present Mode watermark, centered behind the four lesson
 * panels - school branding (or a teacher's own upload from Settings ->
 * Present Mode Branding), never a foreground graphic. Purely decorative
 * (aria-hidden, empty alt, no pointer events). Sized as a fraction of its
 * positioned ancestor rather than the viewport, so the exact same
 * component works both full-screen in Present Mode and shrunk down inside
 * Settings' small preview card.
 *
 * Renders the built-in OHHS Falcon by default, or `customImageSrc` (a
 * `data:` URL) in its place. Unlike the built-in Falcon, a custom upload
 * is shown at full color, not forced to grayscale - it's the user's own
 * supplied image, used as-is.
 *
 * Falcon Deck may not ship a real logo file in every environment - see
 * /public/branding/ohhs-falcon-head.png. Rather than show a broken-image
 * icon if it's missing, this hides itself entirely on load failure.
 */
export function PresentWatermark({
  customImageSrc,
  opacity,
}: {
  customImageSrc?: string;
  opacity: number;
}) {
  const isCustom = Boolean(customImageSrc);
  const src = customImageSrc || DEFAULT_WATERMARK_SRC;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [trackedSrc, setTrackedSrc] = useState(src);

  // A previous image's load failure shouldn't stick around once the
  // configured source itself changes (e.g. switching back to the default
  // after a broken custom upload). Resetting here, during render, rather
  // than in an effect avoids an extra committed render cycle - React's
  // documented pattern for "reset state when a prop changes".
  if (src !== trackedSrc) {
    setTrackedSrc(src);
    setFailedSrc(null);
  }

  if (failedSrc === src) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden"
    >
      <div className="relative h-3/4 w-3/4 max-h-[34rem] max-w-[34rem]">
        <Image
          src={src}
          alt=""
          fill
          sizes="34rem"
          unoptimized={isCustom}
          className={isCustom ? "object-contain" : "object-contain grayscale"}
          style={{ opacity }}
          onError={() => setFailedSrc(src)}
        />
      </div>
    </div>
  );
}
