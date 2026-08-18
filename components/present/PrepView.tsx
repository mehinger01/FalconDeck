import type { ResolvedScheduleBlock } from "@/types/schedule";
import { secondsToClock } from "@/lib/schedule/time";

/**
 * Simple private view shown while a Prep block is active, in place of the
 * student-facing classroom screen.
 */
export function PrepView({
  block,
  remainingSeconds,
}: {
  block: ResolvedScheduleBlock;
  remainingSeconds: number;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.3em] text-falcon-gold-400">
        Private View
      </p>
      <h1 className="text-6xl font-black text-falcon-cream-100 sm:text-7xl">{block.label}</h1>
      <p className="mt-2 text-lg text-falcon-cream-200/60">
        {secondsToClock(remainingSeconds)} remaining
      </p>
    </div>
  );
}
