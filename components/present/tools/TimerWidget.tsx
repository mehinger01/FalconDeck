"use client";

import { secondsToClock } from "@/lib/schedule/time";
import type { ClassroomTimer } from "@/lib/tools/timer/useClassroomTimer";

/**
 * The ambient, always-visible timer display - shown whenever the timer has
 * been started (even if the tool tray is collapsed), large enough to read
 * from the back of the room. Independent of `TimerPanel`'s tray controls:
 * both simply render the same `timer` state, so they can never disagree.
 */
export function TimerWidget({ timer }: { timer: ClassroomTimer }) {
  if (!timer.isActive) return null;

  return (
    <div
      className={`animate-present-fade fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1 rounded-2xl border-2 border-falcon-gold-500 bg-falcon-brown-950/95 px-8 py-4 shadow-2xl ${
        timer.isFinished ? "animate-pulse" : ""
      }`}
    >
      <p
        className={`font-mono text-5xl font-black tabular-nums sm:text-6xl ${
          timer.isFinished ? "text-red-400" : "text-falcon-gold-300"
        }`}
        aria-live="polite"
      >
        {secondsToClock(timer.remainingSeconds)}
      </p>
      <div className="flex items-center gap-3">
        {timer.isRunning ? (
          <button
            type="button"
            onClick={timer.pause}
            className="text-xs font-semibold text-falcon-cream-200/70 hover:text-falcon-cream-100"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={timer.start}
            disabled={timer.remainingSeconds <= 0}
            className="text-xs font-semibold text-falcon-cream-200/70 hover:text-falcon-cream-100 disabled:opacity-40"
          >
            Resume
          </button>
        )}
        <span aria-hidden="true" className="text-falcon-cream-200/30">
          ·
        </span>
        <button
          type="button"
          onClick={timer.reset}
          className="text-xs font-semibold text-falcon-cream-200/70 hover:text-falcon-cream-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
