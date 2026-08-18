"use client";

import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { useNow } from "@/lib/hooks/useNow";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { resolveClassSection, resolveCourseForSection } from "@/lib/data/resolve";
import type { ResolvedScheduleBlock } from "@/types/schedule";
import { ClassroomView } from "./ClassroomView";
import { NoScheduleView } from "./NoScheduleView";
import { PresentHeader } from "./PresentHeader";
import { PrepView } from "./PrepView";
import { TransitionView } from "./TransitionView";

function useDisplayName(classSectionId: string | null | undefined) {
  const { data } = useAppData();
  const section = resolveClassSection(data.classSections, classSectionId);
  const course = resolveCourseForSection(data.courses, section);
  return course?.name ?? section?.name ?? "No Class Assigned";
}

function ClassroomViewContainer({
  block,
  remainingSeconds,
  showCountdown,
}: {
  block: ResolvedScheduleBlock;
  remainingSeconds: number;
  showCountdown: boolean;
}) {
  const displayName = useDisplayName(block.classSectionId);
  return (
    <ClassroomView
      block={block}
      displayName={displayName}
      remainingSeconds={remainingSeconds}
      showCountdown={showCountdown}
    />
  );
}

function TransitionViewContainer({
  interimBlock,
  nextInstructionalBlock,
  secondsUntilNextInstructional,
}: {
  interimBlock: ResolvedScheduleBlock | null;
  nextInstructionalBlock: ResolvedScheduleBlock | null;
  secondsUntilNextInstructional: number | null;
}) {
  const nextDisplayName = useDisplayName(nextInstructionalBlock?.classSectionId);
  return (
    <TransitionView
      interimBlock={interimBlock}
      nextInstructionalBlock={nextInstructionalBlock}
      nextInstructionalDisplayName={nextInstructionalBlock ? nextDisplayName : null}
      secondsUntilNextInstructional={secondsUntilNextInstructional}
    />
  );
}

export function PresentScreen() {
  const schedule = useDefaultSchedule();
  const now = useNow(1000);

  if (!now || !schedule) {
    return (
      <div className="flex flex-1 items-center justify-center bg-falcon-brown-950 text-falcon-cream-200">
        Loading Falcon Deck…
      </div>
    );
  }

  const state = getPresentationState(schedule, now);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-falcon-brown-950">
      <PresentHeader now={now} timeZone={schedule.timeZone} />

      {state.mode === "instructional" && (
        <ClassroomViewContainer
          block={state.block}
          remainingSeconds={state.remainingSeconds}
          showCountdown={state.showCountdown}
        />
      )}

      {state.mode === "prep" && (
        <PrepView block={state.block} remainingSeconds={state.remainingSeconds} />
      )}

      {state.mode === "transition" && (
        <TransitionViewContainer
          interimBlock={state.currentBlock}
          nextInstructionalBlock={state.nextInstructionalBlock}
          secondsUntilNextInstructional={state.secondsUntilNextInstructional}
        />
      )}

      {state.mode === "no-blocks-today" && <NoScheduleView weekday={state.weekday} />}
    </div>
  );
}
