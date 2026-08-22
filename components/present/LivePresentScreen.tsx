"use client";

import { useEffect } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { useNow } from "@/lib/hooks/useNow";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { getLocalDateKey, weekdayForDateKey } from "@/lib/schedule/localDate";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import { resolveSchoolDate } from "@/lib/calendar/resolveSchoolDate";
import { findLessonForSection } from "@/lib/data/lessons";
import { getArrivalInstructions } from "@/lib/data/classPresentation";
import type { DailyLesson } from "@/types/lesson";
import type { ResolvedScheduleBlock } from "@/types/schedule";
import { ClassroomView } from "./ClassroomView";
import { NoScheduleView } from "./NoScheduleView";
import { PresentHeader } from "./PresentHeader";
import { PrepView } from "./PrepView";
import { NoSchoolScreen } from "./calendar/NoSchoolScreen";
import { NoStudentsScreen } from "./calendar/NoStudentsScreen";
import { UnconfiguredScheduleScreen } from "./calendar/UnconfiguredScheduleScreen";
import { EndOfDayScreen } from "./transitions/EndOfDayScreen";
import { LunchScreen } from "./transitions/LunchScreen";
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
 * The live, schedule-driven presentation. Two layers, run in order every
 * tick, off the real wall clock (or `overrideNow`, for Demo Mode's
 * simulator - see Part 15):
 *
 * 1. `resolveSchoolDate` (the Master Calendar layer) - is school even in
 *    session today, and if so, which BellSchedule applies once the
 *    teacher's lunch-wave preference has been resolved onto it?
 * 2. The existing, unmodified schedule engine (`getPresentationState`) -
 *    fed whatever schedule step 1 resolved, exactly as it always was fed
 *    the raw default schedule. Everything below that point (current
 *    block, Prep, transitions, end-of-day, student-facing lesson lookup)
 *    is completely untouched Phase 1-4 logic.
 *
 * The only new branch inside the existing "transition" mode is Lunch:
 * `resolveTeacherSchedule` represents a teacher's lunch wave as an
 * ordinary `kind: "lunch"` block, which naturally falls into
 * `getPresentationState`'s "transition" mode (it's not student-facing) -
 * `currentBlock.kind === "lunch"` swaps in the calm LunchScreen instead of
 * the generic "next class" countdown, and the moment that block ends the
 * engine's own logic resumes the original lesson with zero special-casing.
 *
 * Reports whichever lesson is currently on screen via
 * `onCurrentLessonChange`, so `PresentScreen`'s classroom tools (Quick
 * Resource, QR) can use it without this component knowing tools exist.
 */
export function LivePresentScreen({
  onCurrentLessonChange,
  overrideNow,
}: {
  onCurrentLessonChange?: (lesson: DailyLesson | null) => void;
  /** Demo Mode's Present Simulator feeds a simulated Date here instead of the real wall clock. */
  overrideNow?: Date | null;
}) {
  const liveNow = useNow(1000);
  const now = overrideNow ?? liveNow;
  const { data } = useAppData();
  const settings = data.classroomExperienceSettings;

  const timeZone =
    data.schoolCalendar?.timeZone ?? data.schedules.find((s) => s.isDefault)?.timeZone ?? DEFAULT_TIME_ZONE;
  const dateKey = now ? getLocalDateKey(now, timeZone) : null;

  const dateResolution = dateKey
    ? resolveSchoolDate({
        dateKey,
        calendar: data.schoolCalendar,
        bellSchedules: data.schedules,
        teacherPreferences: data.teacherSchedulePreferences,
      })
    : null;

  const schedule = dateResolution?.resolvedTeacherSchedule ?? null;
  const state = schedule && now ? getPresentationState(schedule, now) : null;
  const currentLesson =
    state?.mode === "student-facing" && state.block.classSectionId && dateKey
      ? findLessonForSection(data.lessons, dateKey, state.block.classSectionId)
      : null;

  useEffect(() => {
    onCurrentLessonChange?.(currentLesson);
  }, [currentLesson, onCurrentLessonChange]);

  if (!now || !dateKey || !dateResolution) {
    return (
      <div className="flex flex-1 items-center justify-center bg-falcon-brown-950 text-falcon-cream-200">
        Loading Falcon Deck…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-falcon-brown-950">
      <PresentHeader now={now} timeZone={timeZone} />

      {dateResolution.status === "no-school" && <NoSchoolScreen title={dateResolution.title} />}
      {dateResolution.status === "no-students" && <NoStudentsScreen title={dateResolution.title} />}
      {dateResolution.status === "unconfigured-schedule" && (
        <UnconfiguredScheduleScreen title={dateResolution.title} />
      )}
      {(dateResolution.status === "weekend" || dateResolution.status === "outside-school-year") && (
        <NoScheduleView weekday={weekdayForDateKey(dateResolution.dateKey)} />
      )}

      {schedule && state && (
        <>
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

          {state.mode === "prep" && <PrepView block={state.block} remainingSeconds={state.remainingSeconds} />}

          {state.mode === "transition" &&
            (state.currentBlock?.kind === "lunch" ? (
              <LunchScreen block={state.currentBlock} />
            ) : state.nextStudentFacingBlock ? (
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
        </>
      )}
    </div>
  );
}
