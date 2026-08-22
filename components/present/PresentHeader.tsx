import { formatZonedDateTime } from "@/lib/schedule/time";

/**
 * Deliberately compact and left-aligned - the four lesson panels are the
 * intended focus of Present Mode, not this header. No longer spans the
 * full width or uses a large wordmark; school branding now comes from the
 * watermark behind the lesson panels instead (see FalconWatermark).
 */
export function PresentHeader({ now, timeZone }: { now: Date; timeZone: string }) {
  return (
    <header className="px-6 pt-5 sm:px-8 sm:pt-6">
      <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-falcon-gold-400/80">
        Falcon Deck
      </p>
      <p className="mt-0.5 text-xs font-medium text-falcon-cream-300/60 sm:text-sm">
        {formatZonedDateTime(now, timeZone)}
      </p>
    </header>
  );
}
