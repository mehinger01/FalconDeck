import type { ResolvedScheduleBlock } from "@/types/schedule";
import { CountdownBanner } from "./CountdownBanner";

export function TransitionView({
  interimBlock,
  nextInstructionalBlock,
  nextInstructionalDisplayName,
  secondsUntilNextInstructional,
}: {
  interimBlock: ResolvedScheduleBlock | null;
  nextInstructionalBlock: ResolvedScheduleBlock | null;
  nextInstructionalDisplayName: string | null;
  secondsUntilNextInstructional: number | null;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-10 text-center">
      {interimBlock && (
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-falcon-cream-200/60">
          Currently: {interimBlock.label}
        </p>
      )}

      <p className="text-sm font-bold uppercase tracking-[0.3em] text-falcon-gold-400">Up Next</p>

      {nextInstructionalBlock && nextInstructionalDisplayName ? (
        <>
          <h1 className="text-5xl font-black text-falcon-cream-100 sm:text-6xl">
            {nextInstructionalDisplayName}
          </h1>
          {secondsUntilNextInstructional !== null && (
            <CountdownBanner
              remainingSeconds={secondsUntilNextInstructional}
              label="Class Begins In"
            />
          )}
        </>
      ) : (
        <h1 className="text-4xl font-black text-falcon-cream-100 sm:text-5xl">
          No more classes today
        </h1>
      )}
    </div>
  );
}
