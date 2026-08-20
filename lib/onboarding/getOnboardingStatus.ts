import type { AppData } from "@/lib/data/types";
import { getLessonPlanningStatus } from "@/lib/week/getLessonPlanningStatus";

export interface OnboardingStatus {
  classesComplete: boolean;
  scheduleComplete: boolean;
  firstLessonComplete: boolean;
  arrivalRoutineComplete: boolean;
  /** Classes + Schedule + First Lesson - the three ingredients Present Mode actually needs. Arrival routines are a nice-to-have, not required. */
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

  return {
    classesComplete,
    scheduleComplete,
    firstLessonComplete,
    arrivalRoutineComplete,
    coreSetupComplete: classesComplete && scheduleComplete && firstLessonComplete,
  };
}
