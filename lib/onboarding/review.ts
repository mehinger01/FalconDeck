import { formatDateKeyLong, weekdayForDateKey } from "@/lib/schedule/localDate";
import { resolveActiveSchedule } from "@/lib/schedule/resolveActiveSchedule";
import { resolveScheduleForWeekday } from "@/lib/schedule/resolveBlockOverride";
import { formatTimeString } from "@/lib/schedule/time";
import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import type { SchoolYearCalendar } from "@/types/calendar";
import type { Course } from "@/types/course";
import type { AppData, DataRepository } from "@/lib/data/types";
import type { BellSchedule, ResolvedScheduleBlock } from "@/types/schedule";
import type { SetupDraft, SetupStep } from "@/types/setupDraft";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";
import { firstLessonIssues } from "./firstLesson";
import { projectSetupDraftToAppData, validateSetupDraft } from "./setupDraft";
import { lunchApplies, summarizeDraft, teachingDayPeriods } from "./teachingDay";

/**
 * Pure helpers behind the guided "Review and start" screen: what the
 * teacher is about to commit, what still blocks it, and the read-only
 * AppData the classroom preview renders. No I/O, no React.
 */

const LUNCH_LABEL: Record<SetupDraft["lunchWave"], string> = { A: "A Lunch", B: "B Lunch", C: "C Lunch", none: "No lunch wave" };

export interface ReviewPeriod {
  label: string;
  time: string;
  className: string | null;
  holdsLunch: boolean;
}

export interface ReviewSummary {
  scheduleName: string | null;
  scheduleKind: "school" | "own" | null;
  periods: ReviewPeriod[];
  /** Shown when it matters: the school schedule has a lunch window, or a lunch wave was chosen. */
  lunch: string | null;
  lesson: {
    className: string | null;
    date: string | null;
    learningTarget: string;
    agenda: string[];
    resources: string[];
    announcements: string[];
  } | null;
}

export function reviewSummary(draft: SetupDraft, schoolSchedules: BellSchedule[]): ReviewSummary {
  const summary = summarizeDraft(draft, schoolSchedules);
  const sectionName = (id: string | null | undefined) => draft.classSections.find((section) => section.id === id)?.name ?? null;
  const lesson = draft.firstLesson;
  return {
    scheduleName: summary.scheduleName,
    scheduleKind: draft.schedule === null ? null : draft.schedule.mode === "shared" ? "school" : "own",
    periods: teachingDayPeriods(draft).map((period) => ({
      label: period.label,
      time: `${formatTimeString(period.startTime)} – ${formatTimeString(period.endTime)}`,
      className: sectionName(period.classSectionId),
      holdsLunch: period.isLunchWindow,
    })),
    lunch: lunchApplies(draft) || draft.lunchWave !== "none" ? LUNCH_LABEL[draft.lunchWave] : null,
    lesson: lesson
      ? {
          className: sectionName(lesson.classSectionId),
          date: /^\d{4}-\d{2}-\d{2}$/.test(lesson.date) ? formatDateKeyLong(lesson.date) : null,
          learningTarget: lesson.learningTarget.trim(),
          agenda: lesson.agendaItems.map((item) => item.title),
          resources: lesson.resources.map((resource) => resource.title),
          announcements: lesson.announcements.map((announcement) => announcement.text),
        }
      : null,
  };
}

export interface ReviewIssue {
  step: Exclude<SetupStep, "review">;
  message: string;
}

/**
 * Everything that still stops completion: the same validateSetupDraft()
 * complete_setup() mirrors, plus the lesson screen's own requirements
 * (class, date, learning target) - each tagged with the step that fixes it.
 */
export function reviewIssues(draft: SetupDraft, reference: { courses: Course[]; schedules: BellSchedule[] }): ReviewIssue[] {
  const issues: ReviewIssue[] = validateSetupDraft(draft, reference).map((issue) => ({
    step: issue.step === "review" ? "first-lesson" : issue.step,
    message: issue.message,
  }));
  for (const message of firstLessonIssues(draft)) {
    if (!issues.some((issue) => issue.message === message)) issues.push({ step: "first-lesson", message });
  }
  // The server's broader lesson messages are covered by the specific ones above.
  return issues.filter(
    (issue, _, all) =>
      !(issue.message.startsWith("Plan a first lesson") && all.some((other) => other.message === "Choose the class this lesson is for.")) &&
      !(issue.message.startsWith("Add a learning target or an agenda item") && all.some((other) => other.message === "Write a learning target.")),
  );
}

/** A complete, empty AppData around the school's reference data - the base a preview is projected onto. */
export function baseAppData(reference: { schedules: BellSchedule[]; courses: Course[]; calendar: SchoolYearCalendar | null }): AppData {
  return {
    courses: reference.courses,
    classSections: [],
    schedules: reference.schedules,
    lessons: [],
    classPresentationSettings: [],
    classroomExperienceSettings: DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
    libraryResources: [],
    teacherSchedulePreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
    schoolCalendar: reference.calendar,
    teacherPeriodAssignments: [],
    transitionOverrides: [],
  };
}

/** What the draft will look like once committed - for the preview only. */
export function previewAppData(draft: SetupDraft, base: AppData, timestamp: string): AppData {
  return projectSetupDraftToAppData(draft, base, timestamp);
}

/**
 * The periods the preview can show the first lesson in: the blocks of the
 * projected active schedule, resolved for the lesson's weekday, that hold
 * its class - the same resolution Present's Preview Mode uses for its
 * period label (components/present/PresentScreen.tsx). A lesson belongs to
 * a class and a date, not a period, so a class that meets more than once
 * that day has several equally valid periods; the caller chooses among
 * them. Empty when the class doesn't meet that weekday (e.g. a weekend).
 */
export function previewPeriods(data: AppData, date: string, classSectionId: string): ResolvedScheduleBlock[] {
  const schedule = resolveActiveSchedule(data.schedules, data.teacherSchedulePreferences);
  if (!schedule || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return resolveScheduleForWeekday(schedule, weekdayForDateKey(date)).filter((block) => block.classSectionId === classSectionId);
}

/**
 * A DataRepository that serves one fixed snapshot and never writes: the
 * preview renders through the real AppDataProvider and Present components,
 * and nothing it does can reach storage or the database.
 */
export function readOnlyRepository(data: AppData): DataRepository {
  return {
    load: async () => data,
    save: async () => ({ ok: true }),
    subscribeToExternalChanges: () => () => {},
  };
}
