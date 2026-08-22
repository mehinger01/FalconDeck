import type { AppData } from "@/lib/data/types";
import { getLessonPlanningStatus } from "@/lib/week/getLessonPlanningStatus";

export interface OnboardingStatus {
  classesComplete: boolean;
  scheduleComplete: boolean;
  firstLessonComplete: boolean;
  arrivalRoutineComplete: boolean;
  libraryResourceComplete: boolean;
  /** Optional - a teacher without a shared lunch structure shouldn't be blocked by this. */
  lunchWaveComplete: boolean;
  /** Optional - Present Mode works fine on just a default BellSchedule; the calendar is what makes it automatic across the whole year. */
  masterCalendarComplete: boolean;
  /** Bell schedules referenced by the Master Calendar (or duplicated presets) that still have no block times - see BellSchedule.needsConfiguration. */
  unresolvedScheduleCount: number;
  /** Classes + Schedule + First Lesson - the three ingredients Present Mode actually needs. Everything else here is a nice-to-have, not required. */
  coreSetupComplete: boolean;
}

/**
 * Derived fresh from `AppData` on every read - onboarding progress is
 * never its own persisted flag, just a projection of whether real setup
 * has happened, so it can never drift out of sync with reality.
 */
export function getOnboardingStatus(data: AppData): OnboardingStatus {
  const classesComplete = data.classSections.length > 0;

  const defaultSchedule = data.schedules.find((schedule) => schedule.isDefault) ?? data.schedules[0] ?? null;
  const scheduleComplete = (defaultSchedule?.blocks.length ?? 0) > 0;

  const firstLessonComplete = data.lessons.some((lesson) => getLessonPlanningStatus(lesson) === "prepared");

  const arrivalRoutineComplete = data.classPresentationSettings.some(
    (settings) => settings.arrivalInstructions.length > 0,
  );

  const libraryResourceComplete = data.libraryResources.length > 0;

  const lunchWaveComplete = data.teacherSchedulePreferences.lunchWave !== "none";
  const masterCalendarComplete = data.schoolCalendar !== null;
  const unresolvedScheduleCount = data.schedules.filter((schedule) => schedule.needsConfiguration).length;

  return {
    classesComplete,
    scheduleComplete,
    firstLessonComplete,
    arrivalRoutineComplete,
    libraryResourceComplete,
    lunchWaveComplete,
    masterCalendarComplete,
    unresolvedScheduleCount,
    coreSetupComplete: classesComplete && scheduleComplete && firstLessonComplete,
  };
}
