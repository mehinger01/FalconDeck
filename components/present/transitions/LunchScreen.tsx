import type { ResolvedScheduleBlock } from "@/types/schedule";
import { formatTimeString } from "@/lib/schedule/time";

/**
 * Shown while the teacher's resolved lunch wave is the active block
 * (`currentBlock.kind === "lunch"`, produced by resolveTeacherSchedule.ts
 * splitting the school-wide lunch window) - a calm state instead of the
 * generic "NEXT CLASS" transition screen. Nothing here decides when lunch
 * starts/ends or what resumes after - that's entirely the existing
 * schedule engine (the post-lunch block shares the original block's
 * classSectionId, so the same lesson just resumes automatically once this
 * screen's block ends).
 */
export function LunchScreen({ block }: { block: ResolvedScheduleBlock }) {
  return (
    <div className="animate-present-fade flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.3em] text-falcon-gold-400">Lunch</p>
      <h1 className="text-6xl font-black text-falcon-cream-100 sm:text-7xl">LUNCH</h1>
      <p className="text-lg text-falcon-cream-200/60">
        {formatTimeString(block.startTime)} – {formatTimeString(block.endTime)}
      </p>
    </div>
  );
}
