import { useState } from "react";
import Image from "next/image";

const DEFAULT_WATERMARK_SRC = "/branding/ohhs-falcon-head.png";

/**
 * Decorative Present Mode watermark/background, behind the four lesson
 * panels - school branding (or a teacher's own upload from Settings ->
 * Present Mode Branding), never a foreground graphic. Purely decorative
 * (aria-hidden, empty alt, no pointer events). Fills its positioned
 * ancestor edge-to-edge (`absolute inset-0` + `object-cover`), so the
 * exact same component works both full-screen in Present Mode and shrunk
 * down inside Settings' small preview card - the official Falcon artwork
 * is a widescreen background composition, not a small centered logo.
 *
 * Renders the built-in OHHS Falcon by default, or `customImageSrc` (a
 * `data:` URL) in its place - always at its own original color. Neither
 * the built-in Falcon nor a custom upload is forced to grayscale; the
 * supplied Falcon artwork is already brown/gold and designed for Falcon
 * Deck's dark background.
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
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none overflow-hidden">
      <Image
        src={src}
        alt=""
        fill
        sizes="100vw"
        unoptimized={isCustom}
        className="object-cover"
        style={{ opacity }}
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}
