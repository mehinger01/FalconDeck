"use client";

import { useAppData } from "@/lib/store/AppDataProvider";
import type { LunchWave } from "@/types/teacherSchedule";
import { LUNCH_WAVE_LABELS } from "@/types/teacherSchedule";

const LUNCH_WAVES: LunchWave[] = ["A", "B", "C", "none"];

/**
 * Teacher-specific preferences - currently just the lunch wave - kept
 * deliberately separate from any BellSchedule: changing it never mutates a
 * base schedule (see resolveTeacherSchedule.ts), it just changes which
 * derived schedule Present Mode resolves each day.
 */
export function MyScheduleSection() {
  const { data, actions } = useAppData();
  const defaultSchedule = data.schedules.find((s) => s.isDefault) ?? null;

  return (
    <section className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">My Daily Schedule</h2>

      <div className="mt-3 flex flex-col gap-1 text-sm text-falcon-brown-900">
        <span className="text-xs font-semibold text-falcon-brown-700/70">Default schedule</span>
        <span className="font-semibold">{defaultSchedule?.name ?? "None set"}</span>
      </div>

      <div className="mt-4">
        <span className="text-xs font-semibold text-falcon-brown-700/70">My Lunch</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {LUNCH_WAVES.map((wave) => {
            const selected = data.teacherSchedulePreferences.lunchWave === wave;
            return (
              <button
                key={wave}
                type="button"
                onClick={() => actions.updateTeacherSchedulePreferences({ lunchWave: wave })}
                className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors ${
                  selected
                    ? "border-falcon-gold-500 bg-falcon-gold-300/20 text-falcon-brown-900"
                    : "border-falcon-brown-700/30 text-falcon-brown-700 hover:bg-falcon-cream-100"
                }`}
              >
                {LUNCH_WAVE_LABELS[wave]}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-falcon-brown-700/60">
          Choose the lunch rotation assigned to you. Falcon Deck uses this to resolve the school-wide
          lunch period automatically in Present Mode.
        </p>
      </div>
    </section>
  );
}
