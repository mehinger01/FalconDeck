import { resolveSchoolDate } from "@/lib/calendar/resolveSchoolDate";
import { formatDateKeyLong, getLocalDateKey } from "@/lib/schedule/localDate";
import { generateId } from "@/lib/store/id";
import type { SchoolYearCalendar } from "@/types/calendar";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft, SetupDraftLesson, SetupStep } from "@/types/setupDraft";
import { ownScheduleToBellSchedule } from "./setupDraft";

/**
 * Pure transforms behind the guided "Your first lesson" screen, in the same
 * style as teachingDay.ts: each takes the current SetupDraft and returns the
 * next. No I/O, no React (see scripts/verify-guided-setup-first-lesson.ts).
 *
 * Nothing here decides a school day for the teacher: the lesson date starts
 * empty, the "today" shortcut is today's date in the schedule's own time
 * zone, and what a date means (weekend, no school, special schedule) comes
 * from the app's existing resolveSchoolDate().
 */

export type IdFactory = (prefix: string) => string;
const defaultIds: IdFactory = generateId;

export function setStep(draft: SetupDraft, step: SetupStep): SetupDraft {
  return draft.step === step ? draft : { ...draft, step };
}

function emptyLesson(ids: IdFactory): SetupDraftLesson {
  return { id: ids("lesson"), date: "", classSectionId: "", learningTarget: "", agendaItems: [], resources: [], announcements: [] };
}

function withLesson(draft: SetupDraft, change: (lesson: SetupDraftLesson) => SetupDraftLesson, ids: IdFactory): SetupDraft {
  return { ...draft, firstLesson: change(draft.firstLesson ?? emptyLesson(ids)) };
}

export type LessonPatch = Partial<Pick<SetupDraftLesson, "classSectionId" | "date" | "learningTarget">>;

/** Edits the lesson's class, date or learning target. The lesson (and its id) is created by the first edit. */
export function updateLesson(draft: SetupDraft, patch: LessonPatch, ids: IdFactory = defaultIds): SetupDraft {
  if (patch.classSectionId !== undefined && patch.classSectionId !== "" && !draft.classSections.some((s) => s.id === patch.classSectionId)) {
    return draft;
  }
  return withLesson(draft, (lesson) => ({ ...lesson, ...patch }), ids);
}

/**
 * A starting learning target the teacher can choose to insert and then edit.
 * Never applied on its own - only by an explicit choice on the screen.
 */
export function sampleLearningTarget(draft: SetupDraft): string {
  const section = draft.classSections.find((s) => s.id === draft.firstLesson?.classSectionId);
  const course = section ? draft.courses.find((c) => c.id === section.courseId)?.name : undefined;
  return course ? `I can explain and use today's key idea in ${course}.` : "I can explain and use today's key idea.";
}

// --- optional content -------------------------------------------------------

export function addAgendaItem(draft: SetupDraft, title: string, ids: IdFactory = defaultIds): SetupDraft {
  if (title.trim() === "") return draft;
  return withLesson(
    draft,
    (lesson) => ({
      ...lesson,
      agendaItems: [...lesson.agendaItems, { id: ids("agenda"), title: title.trim(), isCompleted: false, sortOrder: lesson.agendaItems.length }],
    }),
    ids,
  );
}

export function updateAgendaItem(draft: SetupDraft, id: string, title: string): SetupDraft {
  if (!draft.firstLesson) return draft;
  return { ...draft, firstLesson: { ...draft.firstLesson, agendaItems: draft.firstLesson.agendaItems.map((item) => (item.id === id ? { ...item, title } : item)) } };
}

export function removeAgendaItem(draft: SetupDraft, id: string): SetupDraft {
  if (!draft.firstLesson) return draft;
  const agendaItems = draft.firstLesson.agendaItems.filter((item) => item.id !== id).map((item, index) => ({ ...item, sortOrder: index }));
  return { ...draft, firstLesson: { ...draft.firstLesson, agendaItems } };
}

export function addResource(draft: SetupDraft, resource: { title: string; url: string }, ids: IdFactory = defaultIds): SetupDraft {
  if (resource.title.trim() === "" || resource.url.trim() === "") return draft;
  return withLesson(
    draft,
    (lesson) => ({ ...lesson, resources: [...lesson.resources, { id: ids("resource"), title: resource.title.trim(), url: resource.url.trim(), type: "link" }] }),
    ids,
  );
}

export function removeResource(draft: SetupDraft, id: string): SetupDraft {
  if (!draft.firstLesson) return draft;
  return { ...draft, firstLesson: { ...draft.firstLesson, resources: draft.firstLesson.resources.filter((resource) => resource.id !== id) } };
}

export function addAnnouncement(draft: SetupDraft, text: string, ids: IdFactory = defaultIds): SetupDraft {
  if (text.trim() === "") return draft;
  return withLesson(draft, (lesson) => ({ ...lesson, announcements: [...lesson.announcements, { id: ids("announcement"), text: text.trim() }] }), ids);
}

export function updateAnnouncement(draft: SetupDraft, id: string, text: string): SetupDraft {
  if (!draft.firstLesson) return draft;
  return { ...draft, firstLesson: { ...draft.firstLesson, announcements: draft.firstLesson.announcements.map((a) => (a.id === id ? { ...a, text } : a)) } };
}

export function removeAnnouncement(draft: SetupDraft, id: string): SetupDraft {
  if (!draft.firstLesson) return draft;
  return { ...draft, firstLesson: { ...draft.firstLesson, announcements: draft.firstLesson.announcements.filter((a) => a.id !== id) } };
}

// --- checks and the lesson date ---------------------------------------------

/**
 * What still stops this step: a class from this draft, a date, and a
 * learning target. Stricter than the server's "prepared" rule (target OR an
 * agenda item) on purpose - this screen asks for a learning target.
 */
export function firstLessonIssues(draft: SetupDraft): string[] {
  const lesson = draft.firstLesson;
  const issues: string[] = [];
  if (!lesson || !draft.classSections.some((s) => s.id === lesson.classSectionId)) issues.push("Choose the class this lesson is for.");
  if (!lesson || !/^\d{4}-\d{2}-\d{2}$/.test(lesson.date)) issues.push("Choose the date you'll teach it.");
  if (!lesson || lesson.learningTarget.trim() === "") issues.push("Write a learning target.");
  return issues;
}

function draftBellSchedules(draft: SetupDraft, schoolSchedules: BellSchedule[]): { schedules: BellSchedule[]; activeId: string | null } {
  const schedule = draft.schedule;
  if (schedule?.mode === "own") return { schedules: [ownScheduleToBellSchedule(schedule)], activeId: schedule.id };
  if (schedule?.mode === "shared") return { schedules: schoolSchedules, activeId: schedule.scheduleId };
  return { schedules: [], activeId: null };
}

/** The time zone of the schedule this draft uses, or null if none is chosen. */
export function draftTimeZone(draft: SetupDraft, schoolSchedules: BellSchedule[]): string | null {
  const { schedules, activeId } = draftBellSchedules(draft, schoolSchedules);
  return schedules.find((schedule) => schedule.id === activeId)?.timeZone || null;
}

/** Today's date in the schedule's own time zone - for a one-tap "Today" choice. Null without a schedule. */
export function todayInSchoolTime(draft: SetupDraft, schoolSchedules: BellSchedule[], now: Date): string | null {
  const timeZone = draftTimeZone(draft, schoolSchedules);
  if (!timeZone) return null;
  try {
    return getLocalDateKey(now, timeZone);
  } catch {
    return null;
  }
}

export interface LessonDateNote {
  tone: "info" | "warn";
  message: string;
}

/**
 * What the app already knows about a chosen date, from resolveSchoolDate()
 * with this draft's schedule and the school calendar the teacher can see.
 * Never blocks: a teacher may plan for any day.
 */
export function describeLessonDate(
  draft: SetupDraft,
  reference: { schoolSchedules: BellSchedule[]; schoolCalendar: SchoolYearCalendar | null },
  dateKey: string,
): LessonDateNote | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const { schedules, activeId } = draftBellSchedules(draft, reference.schoolSchedules);
  const resolution = resolveSchoolDate({
    dateKey,
    calendar: reference.schoolCalendar,
    bellSchedules: schedules,
    teacherPreferences: { activeBellScheduleId: activeId, lunchWave: draft.lunchWave },
  });
  const day = formatDateKeyLong(dateKey);
  const plan = "You can still plan for it.";
  switch (resolution.status) {
    case "weekend":
      return { tone: "warn", message: `${day} is a weekend. ${plan}` };
    case "no-school":
      return { tone: "warn", message: `Your school calendar has no school on ${day}${resolution.title ? ` (${resolution.title})` : ""}. ${plan}` };
    case "no-students":
      return { tone: "warn", message: `Your school calendar has no students on ${day}${resolution.title ? ` (${resolution.title})` : ""}. ${plan}` };
    case "outside-school-year":
      return { tone: "warn", message: `${day} is outside your school year. ${plan}` };
    case "special-schedule":
      return { tone: "info", message: `${day} uses a special schedule${resolution.title ? `: ${resolution.title}` : ""}.` };
    case "regular":
      return { tone: "info", message: day };
    default:
      return null;
  }
}
