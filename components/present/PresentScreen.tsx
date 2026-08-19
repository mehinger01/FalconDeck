"use client";

import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { useNow } from "@/lib/hooks/useNow";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { getLocalDateKey } from "@/lib/schedule/localDate";
import { findLessonForSection } from "@/lib/data/lessons";
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
  dateKey,
}: {
  block: ResolvedScheduleBlock;
  remainingSeconds: number;
  showCountdown: boolean;
  dateKey: string;
}) {
  const { data } = useAppData();
  const displayName = useDisplayName(block.classSectionId);
  // The schedule override (if any) already resolved `block.classSectionId`
  // to the right section for today - e.g. Thursday's SAT Prep section
  // instead of the normal Enrichment section - so lesson lookup never
  // needs to know about weekdays or SAT Prep itself.
  const lesson = block.classSectionId
    ? findLessonForSection(data.lessons, dateKey, block.classSectionId)
    : null;
  return (
    <ClassroomView
      block={block}
      displayName={displayName}
      remainingSeconds={remainingSeconds}
      showCountdown={showCountdown}
      dateKey={dateKey}
      lesson={lesson}
    />
  );
}

function TransitionViewContainer({
  interimBlock,
  nextStudentFacingBlock,
  secondsUntilNextStudentFacing,
}: {
  interimBlock: ResolvedScheduleBlock | null;
  nextStudentFacingBlock: ResolvedScheduleBlock | null;
  secondsUntilNextStudentFacing: number | null;
}) {
  const nextDisplayName = useDisplayName(nextStudentFacingBlock?.classSectionId);
  return (
    <TransitionView
      interimBlock={interimBlock}
      nextStudentFacingBlock={nextStudentFacingBlock}
      nextStudentFacingDisplayName={nextStudentFacingBlock ? nextDisplayName : null}
      secondsUntilNextStudentFacing={secondsUntilNextStudentFacing}
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
  const dateKey = getLocalDateKey(now, schedule.timeZone);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-falcon-brown-950">
      <PresentHeader now={now} timeZone={schedule.timeZone} />

      {state.mode === "student-facing" && (
        <ClassroomViewContainer
          block={state.block}
          remainingSeconds={state.remainingSeconds}
          showCountdown={state.showCountdown}
          dateKey={dateKey}
        />
      )}

      {state.mode === "prep" && (
        <PrepView block={state.block} remainingSeconds={state.remainingSeconds} />
      )}

      {state.mode === "transition" && (
        <TransitionViewContainer
          interimBlock={state.currentBlock}
          nextStudentFacingBlock={state.nextStudentFacingBlock}
          secondsUntilNextStudentFacing={state.secondsUntilNextStudentFacing}
        />
      )}

      {state.mode === "no-blocks-today" && <NoScheduleView weekday={state.weekday} />}
    </div>
  );
}
