import type { ResolvedScheduleBlock } from "@/types/schedule";
import { CountdownBanner } from "../CountdownBanner";

/**
 * The automatic between-classes screen: appears the instant the schedule
 * engine reports no student-facing block is active and disappears the
 * instant the next one starts - driven entirely by `LivePresentScreen`'s
 * existing live clock, no click required. `nextBlock`/`nextDisplayName`
 * are only ever resolved from `getPresentationState`'s
 * `nextStudentFacingBlock` - which already excludes Prep, Lunch, and
 * Passing, and already resolves weekday overrides (Enrichment vs. a
 * Thursday SAT Prep block) - so nothing here re-derives or special-cases
 * any of that.
 */
export function TransitionScreen({
  nextBlock,
  nextDisplayName,
  secondsUntilNext,
  arrivalInstructions,
  showCountdown,
  showArrivalInstructions,
}: {
  nextBlock: ResolvedScheduleBlock;
  nextDisplayName: string;
  secondsUntilNext: number;
  arrivalInstructions: string[];
  showCountdown: boolean;
  showArrivalInstructions: boolean;
}) {
  return (
    <div className="animate-present-fade flex flex-1 flex-col items-center justify-center gap-6 px-10 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.3em] text-falcon-gold-400">Next</p>

      <div>
        <h1 className="text-5xl font-black text-falcon-cream-100 sm:text-6xl md:text-7xl">{nextDisplayName}</h1>
        <p className="mt-2 text-lg font-semibold uppercase tracking-[0.2em] text-falcon-cream-200/60">
          {nextBlock.label}
        </p>
      </div>

      {showCountdown && <CountdownBanner remainingSeconds={secondsUntilNext} label="Class Begins In" />}

      {showArrivalInstructions && arrivalInstructions.length > 0 && (
        <div className="text-left">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-falcon-gold-400">Get Ready</p>
          <ul className="mt-2 space-y-1.5 text-lg text-falcon-cream-100">
            {arrivalInstructions.map((instruction, index) => (
              <li key={`${index}-${instruction}`} className="flex items-center gap-2">
                <span aria-hidden="true" className="text-falcon-gold-400">
                  •
                </span>
                {instruction}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
