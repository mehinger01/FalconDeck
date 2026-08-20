"use client";

import { useEffect } from "react";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { useNow } from "@/lib/hooks/useNow";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { getLocalDateKey } from "@/lib/schedule/localDate";
import { findLessonForSection } from "@/lib/data/lessons";
import { getArrivalInstructions } from "@/lib/data/classPresentation";
import type { DailyLesson } from "@/types/lesson";
import type { ResolvedScheduleBlock } from "@/types/schedule";
import { ClassroomView } from "./ClassroomView";
import { NoScheduleView } from "./NoScheduleView";
import { PresentHeader } from "./PresentHeader";
import { PrepView } from "./PrepView";
import { EndOfDayScreen } from "./transitions/EndOfDayScreen";
import { TransitionScreen } from "./transitions/TransitionScreen";
import { useDisplayName } from "./useDisplayName";

function ClassroomViewContainer({
  block,
  lesson,
  remainingSeconds,
  showCountdown,
  dateKey,
  finalFiveMessage,
}: {
  block: ResolvedScheduleBlock;
  lesson: DailyLesson | null;
  remainingSeconds: number;
  showCountdown: boolean;
  dateKey: string;
  finalFiveMessage: string;
}) {
  const displayName = useDisplayName(block.classSectionId);
  return (
    <ClassroomView
      block={block}
      displayName={displayName}
      remainingSeconds={remainingSeconds}
      showCountdown={showCountdown}
      dateKey={dateKey}
      lesson={lesson}
      finalFiveMessage={finalFiveMessage}
    />
  );
}

function TransitionScreenContainer({
  nextBlock,
  secondsUntilNext,
  arrivalInstructions,
  showCountdown,
  showArrivalInstructions,
}: {
  nextBlock: ResolvedScheduleBlock;
  secondsUntilNext: number;
  arrivalInstructions: string[];
  showCountdown: boolean;
  showArrivalInstructions: boolean;
}) {
  const nextDisplayName = useDisplayName(nextBlock.classSectionId);
  return (
    <TransitionScreen
      nextBlock={nextBlock}
      nextDisplayName={nextDisplayName}
      secondsUntilNext={secondsUntilNext}
      arrivalInstructions={arrivalInstructions}
      showCountdown={showCountdown}
      showArrivalInstructions={showArrivalInstructions}
    />
  );
}

/**
 * The live, schedule-driven presentation: current block, automatic
 * transitions, Prep, end-of-day, and student-facing lesson lookup, all off
 * the real wall clock via `getPresentationState` - the schedule engine
 * itself is untouched from Phase 1. Phase 2.5's Preview Mode
 * (`PreviewPresentScreen`) is a separate component precisely so this one
 * never has to change to support it.
 *
 * Reports whichever lesson is currently on screen via
 * `onCurrentLessonChange`, so `PresentScreen`'s classroom tools (Quick
 * Resource, QR) can use it without this component knowing tools exist.
 */
export function LivePresentScreen({
  onCurrentLessonChange,
}: {
  onCurrentLessonChange?: (lesson: DailyLesson | null) => void;
}) {
  const schedule = useDefaultSchedule();
  const now = useNow(1000);
  const { data } = useAppData();
  const settings = data.classroomExperienceSettings;

  const state = schedule && now ? getPresentationState(schedule, now) : null;
  const dateKey = schedule && now ? getLocalDateKey(now, schedule.timeZone) : null;
  const currentLesson =
    state?.mode === "student-facing" && state.block.classSectionId && dateKey
      ? findLessonForSection(data.lessons, dateKey, state.block.classSectionId)
      : null;

  useEffect(() => {
    onCurrentLessonChange?.(currentLesson);
  }, [currentLesson, onCurrentLessonChange]);

  if (!now || !schedule || !state || !dateKey) {
    return (
      <div className="flex flex-1 items-center justify-center bg-falcon-brown-950 text-falcon-cream-200">
        Loading Falcon Deck…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-falcon-brown-950">
      <PresentHeader now={now} timeZone={schedule.timeZone} />

      {state.mode === "student-facing" && (
        <ClassroomViewContainer
          block={state.block}
          lesson={currentLesson}
          remainingSeconds={state.remainingSeconds}
          showCountdown={state.showCountdown}
          dateKey={dateKey}
          finalFiveMessage={settings.finalFiveMessage}
        />
      )}

      {state.mode === "prep" && (
        <PrepView block={state.block} remainingSeconds={state.remainingSeconds} />
      )}

      {state.mode === "transition" &&
        (state.nextStudentFacingBlock ? (
          <TransitionScreenContainer
            nextBlock={state.nextStudentFacingBlock}
            secondsUntilNext={state.secondsUntilNextStudentFacing ?? 0}
            arrivalInstructions={getArrivalInstructions(
              data.classPresentationSettings,
              state.nextStudentFacingBlock.classSectionId,
            )}
            showCountdown={settings.transitionCountdownEnabled}
            showArrivalInstructions={settings.transitionArrivalInstructionsEnabled}
          />
        ) : (
          <EndOfDayScreen show={settings.showEndOfDayScreen} message={settings.endOfDayMessage} />
        ))}

      {state.mode === "no-blocks-today" && <NoScheduleView weekday={state.weekday} />}
    </div>
  );
}
