import { isUsableSharedSchedule } from "@/lib/schedule/isUsableSharedSchedule";
import { secondsToTimeString, timeStringToSeconds } from "@/lib/schedule/time";
import { generateId } from "@/lib/store/id";
import type { Course } from "@/types/course";
import type { BellSchedule, BlockKind } from "@/types/schedule";
import type { SetupDraft, SetupDraftOwnBlock, SetupDraftSchedule, SetupSeed } from "@/types/setupDraft";
import { snapshotSharedBlocks, validateSetupDraft, type SetupDraftIssue } from "./setupDraft";

/**
 * Pure transforms behind the guided "Your teaching day" screen - each takes
 * a SetupDraft and returns the next one, so the screen only ever calls
 * SetupDraftSession.update() with their result. No I/O, no React (see
 * scripts/verify-guided-setup-teaching-day.ts).
 *
 * Invariants every transform keeps:
 * - a class (draft.classSections entry) exists only while a period points
 *   at it - one class per (period, course), named "<course> — <period>";
 * - a draft course exists only while a class uses it (a course is reused
 *   by picking it for another period, never retyped);
 * - nothing about the school day is invented: periods come from a school
 *   schedule the teacher chose or from numbers the teacher typed.
 */

export type IdFactory = (prefix: string) => string;
const defaultIds: IdFactory = generateId;
const defaultUuid = () => crypto.randomUUID();

/** Periods a class can meet in. Passing time, lunch and prep never hold a class. */
const CLASS_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>(["instructional", "enrichment", "custom"]);

export function canHoldClass(kind: BlockKind): boolean {
  return CLASS_KINDS.has(kind);
}

// ---------------------------------------------------------------------------
// Reading the draft
// ---------------------------------------------------------------------------

export interface TeachingDayPeriod {
  blockId: string;
  label: string;
  kind: BlockKind;
  startTime: string;
  endTime: string;
  isLunchWindow: boolean;
  classSectionId: string | null;
}

/** The chosen schedule's periods in day order, with the class each one holds. */
export function teachingDayPeriods(draft: SetupDraft): TeachingDayPeriod[] {
  const schedule = draft.schedule;
  if (schedule === null) return [];
  if (schedule.mode === "shared") {
    return schedule.expectedBlocks.map((block) => ({
      blockId: block.id,
      label: block.label,
      kind: block.kind,
      startTime: block.startTime,
      endTime: block.endTime,
      isLunchWindow: block.isLunchWindow,
      classSectionId: schedule.assignments.find((assignment) => assignment.blockId === block.id)?.classSectionId ?? null,
    }));
  }
  return [...schedule.blocks]
    .sort((a, b) => timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime))
    .map((block) => ({
      blockId: block.id,
      label: block.label,
      kind: block.kind,
      startTime: block.startTime,
      endTime: block.endTime,
      isLunchWindow: false,
      classSectionId: block.classSectionId,
    }));
}

export interface CourseOption {
  id: string;
  name: string;
  /** "draft": typed during setup; "school": already in the school's catalog. */
  source: "draft" | "school";
}

/** Courses a period can be given: the ones typed so far in this draft, then the school's. */
export function courseOptions(draft: SetupDraft, schoolCourses: Course[]): CourseOption[] {
  const seen = new Set<string>();
  const options: CourseOption[] = [];
  for (const course of draft.courses) {
    if (seen.has(course.id)) continue;
    seen.add(course.id);
    options.push({ id: course.id, name: course.name, source: "draft" });
  }
  for (const course of schoolCourses) {
    if (seen.has(course.id)) continue;
    seen.add(course.id);
    options.push({ id: course.id, name: course.name, source: "school" });
  }
  return options;
}

/** The class a period holds, as a course id, or null. */
export function courseIdForPeriod(draft: SetupDraft, period: TeachingDayPeriod): string | null {
  if (period.classSectionId === null) return null;
  return draft.classSections.find((section) => section.id === period.classSectionId)?.courseId ?? null;
}

/** True when the chosen school schedule has a lunch window, so the teacher's lunch wave matters. */
export function lunchApplies(draft: SetupDraft): boolean {
  return draft.schedule?.mode === "shared" && draft.schedule.expectedBlocks.some((block) => block.isLunchWindow);
}

/**
 * Everything on this screen that would stop setup from finishing - the
 * same validateSetupDraft() complete_setup() mirrors, which for a schedule
 * the teacher builds runs the existing Schedule Setup validator.
 */
export function teachingDayIssues(draft: SetupDraft, reference: { courses: Course[]; schedules: BellSchedule[] }): SetupDraftIssue[] {
  return validateSetupDraft(draft, reference).filter((issue) => issue.step === "teaching-day");
}

export interface DraftSummary {
  scheduleName: string | null;
  classNames: string[];
  lunchWave: SetupDraft["lunchWave"];
}

/** A short description of a draft, for choosing between two versions in a conflict. */
export function summarizeDraft(draft: SetupDraft, schedules: BellSchedule[]): DraftSummary {
  const schedule = draft.schedule;
  const scheduleName =
    schedule === null
      ? null
      : schedule.mode === "own"
        ? schedule.name.trim() || "Your own schedule"
        : (schedules.find((candidate) => candidate.id === schedule.scheduleId)?.name ?? "Your school's schedule");
  return { scheduleName, classNames: draft.classSections.map((section) => section.name), lunchWave: draft.lunchWave };
}

// ---------------------------------------------------------------------------
// Choosing or building the schedule
// ---------------------------------------------------------------------------

/** A schedule change drops every class mapping - the periods they named are gone. */
function withSchedule(draft: SetupDraft, schedule: SetupDraftSchedule | null): SetupDraft {
  return { ...draft, schedule, courses: [], classSections: [] };
}

/** Selects a school schedule. Only a usable organization schedule can be chosen. */
export function chooseSharedSchedule(draft: SetupDraft, schedule: BellSchedule): SetupDraft {
  if (!isUsableSharedSchedule(schedule)) return draft;
  if (draft.schedule?.mode === "shared" && draft.schedule.scheduleId === schedule.id) return draft;
  return withSchedule(draft, {
    mode: "shared",
    scheduleId: schedule.id,
    expectedBlocks: snapshotSharedBlocks(schedule),
    assignments: [],
  });
}

export function clearSchedule(draft: SetupDraft): SetupDraft {
  return withSchedule(draft, null);
}

/** True when changing the schedule would discard classes the teacher has mapped. */
export function scheduleChangeLosesClasses(draft: SetupDraft): boolean {
  return draft.classSections.length > 0;
}

export interface QuickScheduleInput {
  periodCount: number;
  /** "HH:mm" */
  firstStart: string;
  periodMinutes: number;
  passingMinutes: number;
}

export type QuickScheduleResult = { ok: true; blocks: SetupDraftOwnBlock[] } | { ok: false; message: string };

const LAST_MINUTE_OF_DAY = 23 * 3600 + 59 * 60;

/**
 * Periods generated from the four numbers the teacher typed. Nothing is
 * assumed: every input is required, and the result is only a starting
 * point - each period stays editable before the teacher continues.
 */
export function buildQuickSchedulePeriods(input: QuickScheduleInput, ids: IdFactory = defaultIds): QuickScheduleResult {
  const { periodCount, firstStart, periodMinutes, passingMinutes } = input;
  if (!Number.isInteger(periodCount) || periodCount < 1 || periodCount > 12) {
    return { ok: false, message: "Enter how many periods you have (1 to 12)." };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(firstStart)) {
    return { ok: false, message: "Enter when your first period starts." };
  }
  if (!Number.isInteger(periodMinutes) || periodMinutes < 5 || periodMinutes > 240) {
    return { ok: false, message: "Enter how long each period is, in minutes (5 to 240)." };
  }
  if (!Number.isInteger(passingMinutes) || passingMinutes < 0 || passingMinutes > 60) {
    return { ok: false, message: "Enter the minutes between periods (0 to 60)." };
  }
  const blocks: SetupDraftOwnBlock[] = [];
  let start = timeStringToSeconds(firstStart);
  for (let index = 0; index < periodCount; index += 1) {
    const end = start + periodMinutes * 60;
    if (end > LAST_MINUTE_OF_DAY) {
      return { ok: false, message: "Those periods would run past midnight. Check the numbers." };
    }
    blocks.push({
      id: ids("block"),
      label: `Period ${index + 1}`,
      kind: "instructional",
      startTime: secondsToTimeString(start),
      endTime: secondsToTimeString(end),
      classSectionId: null,
    });
    start = end + passingMinutes * 60;
  }
  return { ok: true, blocks };
}

/** Starts (or replaces) the teacher's own schedule with these periods. */
export function startOwnSchedule(
  draft: SetupDraft,
  own: { name: string; timeZone: string; blocks: SetupDraftOwnBlock[] },
  ids: IdFactory = defaultIds,
): SetupDraft {
  const id = draft.schedule?.mode === "own" ? draft.schedule.id : ids("schedule");
  return withSchedule(draft, { mode: "own", id, name: own.name, timeZone: own.timeZone, blocks: own.blocks });
}

export function updateOwnScheduleDetails(draft: SetupDraft, patch: { name?: string; timeZone?: string }): SetupDraft {
  if (draft.schedule?.mode !== "own") return draft;
  return { ...draft, schedule: { ...draft.schedule, ...patch } };
}

export type OwnBlockPatch = Partial<Pick<SetupDraftOwnBlock, "label" | "kind" | "startTime" | "endTime">>;

/** Edits one of the teacher's own periods. A period that can no longer hold a class loses its class. */
export function updateOwnBlock(draft: SetupDraft, blockId: string, patch: OwnBlockPatch, schoolCourses: Course[] = []): SetupDraft {
  if (draft.schedule?.mode !== "own") return draft;
  const blocks = draft.schedule.blocks.map((block) => {
    if (block.id !== blockId) return block;
    const next = { ...block, ...patch };
    return canHoldClass(next.kind) ? next : { ...next, classSectionId: null };
  });
  return normalizeClasses({ ...draft, schedule: { ...draft.schedule, blocks } }, schoolCourses);
}

/** Adds a period after the last one, the same length as it - from the teacher's own periods, never a guess. */
export function addOwnBlock(draft: SetupDraft, ids: IdFactory = defaultIds): SetupDraft {
  if (draft.schedule?.mode !== "own" || draft.schedule.blocks.length === 0) return draft;
  const ordered = teachingDayPeriods(draft);
  const last = ordered[ordered.length - 1];
  const length = Math.max(timeStringToSeconds(last.endTime) - timeStringToSeconds(last.startTime), 60);
  const start = Math.min(timeStringToSeconds(last.endTime), LAST_MINUTE_OF_DAY - 60);
  const block: SetupDraftOwnBlock = {
    id: ids("block"),
    label: `Period ${draft.schedule.blocks.length + 1}`,
    kind: "instructional",
    startTime: secondsToTimeString(start),
    endTime: secondsToTimeString(Math.min(start + length, LAST_MINUTE_OF_DAY)),
    classSectionId: null,
  };
  return { ...draft, schedule: { ...draft.schedule, blocks: [...draft.schedule.blocks, block] } };
}

export function removeOwnBlock(draft: SetupDraft, blockId: string, schoolCourses: Course[] = []): SetupDraft {
  if (draft.schedule?.mode !== "own") return draft;
  const blocks = draft.schedule.blocks.filter((block) => block.id !== blockId);
  return normalizeClasses({ ...draft, schedule: { ...draft.schedule, blocks } }, schoolCourses);
}

// ---------------------------------------------------------------------------
// Classes and courses
// ---------------------------------------------------------------------------

export type PeriodCourseChoice = { kind: "none" } | { kind: "course"; courseId: string } | { kind: "new"; name: string };

function className(courseName: string, periodLabel: string): string {
  return `${courseName.trim()} — ${periodLabel.trim()}`;
}

/**
 * Gives a period a course (an existing one, or a new one typed now), or
 * clears it. A new course whose name matches one already available is
 * reused rather than duplicated.
 */
export function setPeriodCourse(
  draft: SetupDraft,
  blockId: string,
  choice: PeriodCourseChoice,
  schoolCourses: Course[],
  ids: IdFactory = defaultIds,
  newUuid: () => string = defaultUuid,
): SetupDraft {
  const period = teachingDayPeriods(draft).find((candidate) => candidate.blockId === blockId);
  if (!period || !canHoldClass(period.kind) || draft.schedule === null) return draft;

  const available = courseOptions(draft, schoolCourses);
  let courses = draft.courses;
  let courseId: string | null = null;
  if (choice.kind === "course") {
    if (!available.some((option) => option.id === choice.courseId)) return draft;
    courseId = choice.courseId;
  } else if (choice.kind === "new") {
    const name = choice.name.trim();
    if (name === "") return draft;
    const match = available.find((option) => option.name.trim().toLowerCase() === name.toLowerCase());
    if (match) {
      courseId = match.id;
    } else {
      courseId = ids("course");
      courses = [...courses, { id: courseId, name }];
    }
  }

  const previous = period.classSectionId ? draft.classSections.find((section) => section.id === period.classSectionId) : undefined;
  let classSections = draft.classSections.filter((section) => section.id !== previous?.id);
  let sectionId: string | null = null;
  if (courseId !== null) {
    sectionId = previous && previous.courseId === courseId ? previous.id : ids("section");
    classSections = [...classSections, { id: sectionId, courseId, name: "" }];
  }

  let schedule: SetupDraftSchedule;
  if (draft.schedule.mode === "shared") {
    const kept = draft.schedule.assignments.filter((assignment) => assignment.blockId !== blockId);
    const existing = draft.schedule.assignments.find((assignment) => assignment.blockId === blockId);
    schedule = {
      ...draft.schedule,
      assignments: sectionId === null ? kept : [...kept, { id: existing?.id ?? newUuid(), blockId, classSectionId: sectionId }],
    };
  } else {
    schedule = {
      ...draft.schedule,
      blocks: draft.schedule.blocks.map((block) => (block.id === blockId ? { ...block, classSectionId: sectionId } : block)),
    };
  }
  return normalizeClasses({ ...draft, courses, classSections, schedule }, schoolCourses);
}

/**
 * Restores the invariants after any edit: classes no period points at are
 * removed, courses no class uses are removed, and every class is named
 * from its course and its period's current label.
 */
function normalizeClasses(draft: SetupDraft, schoolCourses: Course[] = []): SetupDraft {
  const periods = teachingDayPeriods(draft);
  const periodBySection = new Map(periods.filter((p) => p.classSectionId !== null).map((p) => [p.classSectionId as string, p]));
  const courseName = new Map([...schoolCourses, ...draft.courses].map((course) => [course.id, course.name]));
  const classSections = draft.classSections
    .filter((section) => periodBySection.has(section.id))
    .map((section) => {
      const period = periodBySection.get(section.id) as TeachingDayPeriod;
      const name = courseName.has(section.courseId) ? className(courseName.get(section.courseId) as string, period.label) : section.name;
      return section.name === name ? section : { ...section, name };
    });
  const usedCourses = new Set(classSections.map((section) => section.courseId));
  const courses = draft.courses.filter((course) => usedCourses.has(course.id));
  let schedule = draft.schedule;
  if (schedule?.mode === "shared") {
    const live = new Set(classSections.map((section) => section.id));
    schedule = { ...schedule, assignments: schedule.assignments.filter((assignment) => live.has(assignment.classSectionId)) };
  }
  return { ...draft, courses, classSections, schedule };
}

export function setLunchWave(draft: SetupDraft, lunchWave: SetupDraft["lunchWave"]): SetupDraft {
  return { ...draft, lunchWave };
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

export interface RefreshedSchedule {
  draft: SetupDraft;
  /** Period labels whose classes were removed because the period no longer exists. */
  removedPeriods: string[];
}

/**
 * Brings a shared-schedule draft up to date with the school's current
 * schedule: periods that still exist keep their classes (renamed if the
 * period was), periods that are gone lose theirs and are reported.
 */
export function refreshSharedSchedule(draft: SetupDraft, schedules: BellSchedule[], schoolCourses: Course[] = []): RefreshedSchedule {
  const shared = draft.schedule;
  if (shared?.mode !== "shared") return { draft, removedPeriods: [] };
  const current = schedules.find((schedule) => schedule.id === shared.scheduleId);
  const assigned = new Set(shared.assignments.map((assignment) => assignment.blockId));
  const assignedLabels = (keep: Set<string>) =>
    shared.expectedBlocks.filter((block) => assigned.has(block.id) && !keep.has(block.id)).map((block) => block.label);
  if (!current || !isUsableSharedSchedule(current)) {
    return { draft: clearSchedule(draft), removedPeriods: assignedLabels(new Set()) };
  }
  const expectedBlocks = snapshotSharedBlocks(current);
  const liveIds = new Set(expectedBlocks.map((block) => block.id));
  const next = normalizeClasses(
    {
      ...draft,
      schedule: {
        ...shared,
        expectedBlocks,
        assignments: shared.assignments.filter((assignment) => liveIds.has(assignment.blockId)),
      },
    },
    schoolCourses,
  );
  return { draft: next, removedPeriods: assignedLabels(liveIds) };
}

/**
 * The draft brought into line with schedule preferences changed elsewhere
 * (a "preferences-changed" conflict): the lunch wave reported, and the
 * reported active schedule if it is one of the school's - which replaces a
 * schedule the teacher was building, since completion cannot override a
 * schedule made active elsewhere.
 */
export function adoptReportedPreferences(draft: SetupDraft, preferences: SetupSeed, schedules: BellSchedule[]): SetupDraft {
  let next: SetupDraft = { ...draft, lunchWave: preferences.lunchWave };
  const reported = preferences.activeBellScheduleId;
  if (reported !== null && !(next.schedule?.mode === "shared" && next.schedule.scheduleId === reported)) {
    const schedule = schedules.find((candidate) => candidate.id === reported);
    if (schedule && isUsableSharedSchedule(schedule)) next = chooseSharedSchedule(next, schedule);
  }
  return next;
}
