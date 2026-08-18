import { formatZonedDateTime } from "@/lib/schedule/time";

export function PresentHeader({ now, timeZone }: { now: Date; timeZone: string }) {
  return (
    <header className="flex items-start justify-between px-10 pt-8 sm:px-16 sm:pt-10">
      <div>
        <p className="text-3xl font-extrabold tracking-tight text-falcon-gold-400 sm:text-4xl">
          Falcon Deck
        </p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-falcon-cream-300/70">
          Ogemaw Heights Falcons
        </p>
      </div>
      <p className="text-right text-sm font-medium text-falcon-cream-200/80 sm:text-base">
        {formatZonedDateTime(now, timeZone)}
      </p>
    </header>
  );
}
