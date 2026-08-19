import type { DailyLesson } from "@/types/lesson";

export const LESSON_PLANNING_STATUSES = ["missing", "draft", "prepared"] as const;
export type LessonPlanningStatus = (typeof LESSON_PLANNING_STATUSES)[number];

/**
 * Classifies a (possibly absent) lesson for the Week grid:
 * - "missing": no DailyLesson record at all.
 * - "draft": a DailyLesson exists but has no meaningful content yet (the
 *   teacher opened it, or it was created via a weekly-planning shortcut,
 *   but nothing has actually been planned).
 * - "prepared": at least one meaningful field is filled in - a non-empty
 *   learning target, or any agenda item, resource, or announcement.
 *
 * This is presentation-status only, not a persisted field on DailyLesson -
 * it's always derived fresh from the lesson's actual content.
 */
export function getLessonPlanningStatus(lesson: DailyLesson | null): LessonPlanningStatus {
  if (!lesson) return "missing";

  const hasMeaningfulContent =
    lesson.learningTarget.trim().length > 0 ||
    lesson.agendaItems.length > 0 ||
    lesson.resources.length > 0 ||
    lesson.announcements.length > 0;

  return hasMeaningfulContent ? "prepared" : "draft";
}
