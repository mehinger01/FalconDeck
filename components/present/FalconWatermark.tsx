import { useState } from "react";
import Image from "next/image";

/**
 * Decorative Ogemaw Heights Falcon head watermark, centered behind the
 * four lesson panels in Present Mode - school branding, not a foreground
 * graphic. Purely decorative (aria-hidden, empty alt, no pointer events),
 * low opacity, and grayscale so it never competes with lesson content or
 * depends on the source image's own color treatment.
 *
 * Falcon Deck does not ship a real logo file yet - see
 * /public/branding/ohhs-falcon-head.png. Rather than show a broken-image
 * icon until one is supplied, this hides itself entirely on load failure.
 */
export function FalconWatermark() {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex select-none items-center justify-center"
    >
      <div className="relative h-[50vh] w-[50vh] max-h-[34rem] max-w-[34rem]">
        <Image
          src="/branding/ohhs-falcon-head.png"
          alt=""
          fill
          sizes="34rem"
          className="object-contain opacity-[0.08] grayscale"
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}
