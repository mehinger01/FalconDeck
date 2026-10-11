import type { ClassSection, Course } from "./course";
import type { AgendaItem, Announcement, LessonResource } from "./lesson";
import type { BlockKind } from "./schedule";
import type { LunchWave } from "./teacherSchedule";

/**
 * Guided-setup draft models - see docs/ONBOARDING_SETUP_ARCHITECTURE.md.
 *
 * A SetupDraft is everything a new teacher has entered so far in the
 * school -> teaching day -> first lesson -> present flow. It is deliberately
 * NOT part of AppData: nothing in it is operational until complete_setup()
 * commits it, and it is stored, autosaved, and revised on its own (see
 * lib/onboarding/setupRepository.ts), never through DataRepository.
 *
 * Every id in a draft is generated once, client-side, when the item is
 * first added, and then lives in the saved draft - so a completion retried
 * from any tab, any number of times, names exactly the same rows.
 */
export const SETUP_DRAFT_VERSION = 1;

/** Where to resume. A UI hint only - never consulted when completing. */
export type SetupStep = "teaching-day" | "first-lesson" | "review";

/** A course the teacher is creating during setup - always teacher-owned once committed. */
export type SetupDraftCourse = Pick<Course, "id" | "name" | "colorHex" | "description">;

/** `courseId` may name a SetupDraftCourse from this same draft, or an existing course the teacher can already use. */
export type SetupDraftClassSection = ClassSection;

/** One period of a shared schedule as the teacher saw it when they chose it. */
export interface SharedBlockSnapshot {
  /** The ScheduleBlock's own (schedule-local) id. */
  id: string;
  label: string;
  kind: BlockKind;
  startTime: string;
  endTime: string;
}

export interface SetupDraftAssignment {
  /** A real UUID - becomes teacher_period_assignments.id, see TeacherPeriodAssignment.id. */
  id: string;
  blockId: string;
  classSectionId: string;
}

export interface SetupDraftOwnBlock {
  id: string;
  label: string;
  kind: BlockKind;
  customKindLabel?: string;
  /** 24h "HH:mm" */
  startTime: string;
  /** 24h "HH:mm" */
  endTime: string;
  classSectionId: string | null;
}

/**
 * "shared": use an organization-owned schedule as-is and record only this
 * teacher's own period assignments. `expectedBlocks` is that schedule's
 * periods at the moment it was chosen; completion is refused if they no
 * longer match.
 *
 * "own": build a private schedule inside the same organization.
 */
export type SetupDraftSchedule =
  | { mode: "shared"; scheduleId: string; expectedBlocks: SharedBlockSnapshot[]; assignments: SetupDraftAssignment[] }
  | { mode: "own"; id: string; name: string; timeZone: string; blocks: SetupDraftOwnBlock[] };

export interface SetupDraftLesson {
  id: string;
  /** School-local date, "YYYY-MM-DD". */
  date: string;
  classSectionId: string;
  learningTarget: string;
  agendaItems: AgendaItem[];
  resources: LessonResource[];
  announcements: Announcement[];
  materials?: string;
  warmup?: string;
}

export interface SetupDraft {
  version: typeof SETUP_DRAFT_VERSION;
  step: SetupStep;
  courses: SetupDraftCourse[];
  classSections: SetupDraftClassSection[];
  schedule: SetupDraftSchedule | null;
  lunchWave: LunchWave;
  firstLesson: SetupDraftLesson | null;
}
