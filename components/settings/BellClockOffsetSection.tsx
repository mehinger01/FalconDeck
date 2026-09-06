"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { useNow } from "@/lib/hooks/useNow";
import {
  applyBellOffset,
  clampBellOffsetSeconds,
  BELL_OFFSET_MIN_SECONDS,
  BELL_OFFSET_MAX_SECONDS,
  DEFAULT_TIME_ZONE,
  formatZonedDateTime,
} from "@/lib/schedule/time";

const OFFSET_STEP_BUTTON_CLASS =
  "rounded-md border border-falcon-brown-700/30 px-2.5 py-1 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-brown-700/10";

function formatSignedOffset(seconds: number): string {
  if (seconds === 0) return "0 seconds";
  const magnitude = Math.abs(seconds);
  return `${seconds > 0 ? "+" : "-"}${magnitude} second${magnitude === 1 ? "" : "s"}`;
}

/**
 * Calibrates Falcon Deck's live clock to the school's actual bell system.
 * A single `useNow(1000)` subscription drives both displayed clocks -
 * Falcon Deck Time is always `applyBellOffset(computerTime, bellOffsetSeconds)`
 * applied to that same tick, never a second independent clock, so the two
 * can never disagree for any reason other than the offset itself.
 */
export function BellClockOffsetSection() {
  const { data, actions } = useAppData();
  const bellOffsetSeconds = data.classroomExperienceSettings.bellOffsetSeconds;
  const timeZone =
    data.schoolCalendar?.timeZone ?? data.schedules.find((s) => s.isDefault)?.timeZone ?? DEFAULT_TIME_ZONE;

  const computerTime = useNow(1000);
  const falconDeckTime = computerTime ? applyBellOffset(computerTime, bellOffsetSeconds) : null;

  // A local string draft so an in-progress edit (an empty field, a lone
  // "-") never round-trips NaN into settings - only a valid finite number
  // is ever committed via updateClassroomExperienceSettings.
  const [draft, setDraft] = useState<string | null>(null);
  const inputValue = draft ?? String(bellOffsetSeconds);

  function commit(seconds: number) {
    actions.updateClassroomExperienceSettings({ bellOffsetSeconds: clampBellOffsetSeconds(seconds) });
    setDraft(null);
  }

  function handleInputChange(value: string) {
    setDraft(value);
    const parsed = Number(value);
    if (value.trim() !== "" && Number.isFinite(parsed)) {
      commit(parsed);
    }
  }

  function step(deltaSeconds: number) {
    commit(bellOffsetSeconds + deltaSeconds);
  }

  return (
    <section className="mt-6 rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Bell Clock Offset</h2>
      <p className="mt-1 text-sm text-falcon-brown-700/70">
        Calibrates Falcon Deck to your school&rsquo;s actual bell system, if it doesn&rsquo;t match this
        computer&rsquo;s clock exactly.
      </p>

      <div className="mt-3 flex flex-col gap-1 text-sm text-falcon-brown-900">
        <p>
          <span className="font-semibold text-falcon-brown-700/70">Computer Time:</span>{" "}
          {computerTime ? formatZonedDateTime(computerTime, timeZone) : "—"}
        </p>
        <p>
          <span className="font-semibold text-falcon-brown-700/70">Bell Offset:</span>{" "}
          {formatSignedOffset(bellOffsetSeconds)}
        </p>
        <p>
          <span className="font-semibold text-falcon-brown-700/70">Falcon Deck Time:</span>{" "}
          {falconDeckTime ? formatZonedDateTime(falconDeckTime, timeZone) : "—"}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => step(-5)} className={OFFSET_STEP_BUTTON_CLASS}>
          −5
        </button>
        <button type="button" onClick={() => step(-1)} className={OFFSET_STEP_BUTTON_CLASS}>
          −1
        </button>

        <input
          type="number"
          inputMode="numeric"
          min={BELL_OFFSET_MIN_SECONDS}
          max={BELL_OFFSET_MAX_SECONDS}
          step={1}
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onBlur={() => setDraft(null)}
          aria-label="Bell offset in seconds"
          className="w-20 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-center text-sm text-falcon-brown-900"
        />

        <button type="button" onClick={() => step(1)} className={OFFSET_STEP_BUTTON_CLASS}>
          +1
        </button>
        <button type="button" onClick={() => step(5)} className={OFFSET_STEP_BUTTON_CLASS}>
          +5
        </button>

        <button
          type="button"
          onClick={() => commit(0)}
          className="ml-2 rounded-md border border-falcon-brown-700/30 px-3 py-1 text-sm font-semibold text-falcon-brown-700/70 hover:bg-falcon-brown-700/10"
        >
          Reset to 0
        </button>
      </div>
    </section>
  );
}
