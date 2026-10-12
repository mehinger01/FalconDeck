import type { ClassSection, Course } from "./course";
import type { AgendaItem, Announcement, LessonResource } from "./lesson";
import type { BlockKind, Weekday } from "./schedule";
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

/**
 * One weekday variation of a shared period. `null` means "not overridden
 * on this weekday" - written as an explicit null (never an omitted key) so
 * the value survives JSON and compares equal to what complete_setup()
 * builds from the database row.
 */
export interface SharedOverrideSnapshot {
  weekday: Weekday;
  label: string | null;
  kind: BlockKind | null;
  customKindLabel: string | null;
  startTime: string | null;
  endTime: string | null;
}

/** One period of a shared schedule as the teacher saw it when they chose it. */
export interface SharedBlockSnapshot {
  /** The ScheduleBlock's own (schedule-local) id. */
  id: string;
  label: string;
  kind: BlockKind;
  startTime: string;
  endTime: string;
  /** The label of a "custom" kind; `null` when the period has none. */
  customKindLabel: string | null;
  /** Whether this period is the window a teacher's lunch wave sits inside - it changes how the teacher's day is split. */
  isLunchWindow: boolean;
  /** Sorted by weekday name, so two snapshots of the same schedule are always deep-equal. */
  overrides: SharedOverrideSnapshot[];
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
 * periods - base times and weekday overrides - at the moment it was chosen;
 * completion is refused if they no longer match.
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

/** What a membership already chose on the existing setup screens before entering guided setup - see createSetupDraftFromSeed. */
export interface SetupSeed {
  activeBellScheduleId: string | null;
  lunchWave: LunchWave;
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
