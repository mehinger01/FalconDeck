"use client";

import { useNow } from "@/lib/hooks/useNow";
import { formatZonedDateTime, secondsToClock } from "@/lib/schedule/time";
import type { ClassroomTimer } from "@/lib/tools/timer/useClassroomTimer";

/**
 * A calm, fullscreen student-facing display that replaces whatever's on
 * screen with one short message - independent work, testing, discussion,
 * teacher explanation. Purely a visual overlay: it never reads or writes
 * `DailyLesson` or schedule state, so exiting it returns to exactly
 * whatever the live schedule (or Preview) was already showing.
 */
export function CleanScreenOverlay({
  message,
  timeZone,
  showClock,
  timer,
  onExit,
}: {
  message: string;
  timeZone: string;
  showClock: boolean;
  timer: ClassroomTimer;
  onExit: () => void;
}) {
  const now = useNow(1000);

  return (
    <div className="animate-present-fade fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-falcon-brown-950 px-10 text-center">
      <h1 className="text-6xl font-black uppercase tracking-wide text-falcon-cream-100 sm:text-7xl">
        {message}
      </h1>

      {timer.isActive && (
        <p className="font-mono text-4xl font-bold tabular-nums text-falcon-gold-300" aria-live="polite">
          {secondsToClock(timer.remainingSeconds)}
        </p>
      )}

      {showClock && now && (
        <p className="text-lg text-falcon-cream-200/60">{formatZonedDateTime(now, timeZone)}</p>
      )}

      <button
        type="button"
        onClick={onExit}
        className="absolute bottom-4 right-4 rounded-md px-3 py-1.5 text-xs font-semibold text-falcon-cream-200/40 hover:bg-falcon-cream-200/10 hover:text-falcon-cream-200/80"
      >
        Exit Clean Screen
      </button>
    </div>
  );
}
