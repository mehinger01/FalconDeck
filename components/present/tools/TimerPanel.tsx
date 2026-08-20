"use client";

import { useState } from "react";
import { secondsToClock } from "@/lib/schedule/time";
import { TIMER_PRESET_MINUTES, type ClassroomTimer } from "@/lib/tools/timer/useClassroomTimer";

const ADJUST_STEP_SECONDS = 30;

/**
 * The Timer tool's tray controls - presets, a custom duration, start/
 * pause/reset, and +/- adjustments. All the actual countdown logic lives
 * in `useClassroomTimer`; this component only calls the handlers it's
 * given, so nothing here can drift out of sync with the ambient
 * `TimerWidget` showing the same `timer` state elsewhere on screen.
 */
export function TimerPanel({ timer }: { timer: ClassroomTimer }) {
  const [customMinutes, setCustomMinutes] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-center font-mono text-4xl font-black tabular-nums text-falcon-cream-100" aria-live="polite">
        {secondsToClock(timer.remainingSeconds)}
      </p>

      <div className="flex flex-wrap justify-center gap-1.5">
        {TIMER_PRESET_MINUTES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => timer.setDuration(minutes * 60)}
            className="rounded-md border border-falcon-cream-200/20 px-2.5 py-1 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-cream-200/10"
          >
            {minutes} min
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const minutes = Number(customMinutes);
          if (!Number.isFinite(minutes) || minutes <= 0) return;
          timer.setDuration(Math.round(minutes * 60));
          setCustomMinutes("");
        }}
        className="flex gap-1.5"
      >
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={customMinutes}
          onChange={(event) => setCustomMinutes(event.target.value)}
          placeholder="Custom min"
          className="w-24 rounded border border-falcon-cream-200/20 bg-falcon-brown-900 px-2 py-1 text-sm text-falcon-cream-100"
        />
        <button
          type="submit"
          className="rounded-md border border-falcon-cream-200/20 px-2.5 py-1 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-cream-200/10"
        >
          Set
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          type="button"
          aria-label="Subtract 30 seconds"
          onClick={() => timer.adjustRemaining(-ADJUST_STEP_SECONDS)}
          className="rounded-md border border-falcon-cream-200/20 px-2.5 py-1 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-cream-200/10"
        >
          −30s
        </button>
        <button
          type="button"
          aria-label="Add 30 seconds"
          onClick={() => timer.adjustRemaining(ADJUST_STEP_SECONDS)}
          className="rounded-md border border-falcon-cream-200/20 px-2.5 py-1 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-cream-200/10"
        >
          +30s
        </button>
        {timer.isRunning ? (
          <button
            type="button"
            onClick={timer.pause}
            className="rounded-md bg-falcon-gold-400 px-3 py-1 text-xs font-bold text-falcon-brown-950 hover:bg-falcon-gold-300"
          >
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={timer.start}
            disabled={timer.remainingSeconds <= 0}
            className="rounded-md bg-falcon-gold-400 px-3 py-1 text-xs font-bold text-falcon-brown-950 hover:bg-falcon-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start
          </button>
        )}
        <button
          type="button"
          onClick={timer.reset}
          className="rounded-md border border-falcon-cream-200/20 px-3 py-1 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-cream-200/10"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
