import type { AppData } from "@/lib/data/types";
import { deepEqual } from "@/lib/data/supabaseMapping";
import { isUsableSharedSchedule } from "@/lib/schedule/isUsableSharedSchedule";
import { timeStringToSeconds } from "@/lib/schedule/time";
import { validateSchedule } from "@/lib/schedule/validateSchedule";
import { getLessonPlanningStatus } from "@/lib/week/getLessonPlanningStatus";
import type { DailyLesson } from "@/types/lesson";
import type { BellSchedule, ScheduleBlock } from "@/types/schedule";
import {
  SETUP_DRAFT_VERSION,
  type SetupDraft,
  type SetupDraftSchedule,
  type SetupStep,
  type SharedBlockSnapshot,
} from "@/types/setupDraft";

/**
 * Pure guided-setup logic - no I/O, no React, no Supabase. Everything the
 * setup UI needs to reason about a draft lives here so it is testable
 * directly (see scripts/verify-onboarding-setup-foundation.ts).
 */

export function createEmptySetupDraft(): SetupDraft {
  return {
    version: SETUP_DRAFT_VERSION,
    step: "teaching-day",
    courses: [],
    classSections: [],
    schedule: null,
    lunchWave: "none",
    firstLesson: null,
  };
}

/**
 * Accepts a stored draft payload only if it is a shape this build
 * understands. Deliberately shallow: the payload was written by this same
 * app, so this guards against a version mismatch or a truncated/foreign
 * value - it is not the integrity check (complete_setup() is).
 */
export function parseSetupDraft(value: unknown): SetupDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<SetupDraft>;
  if (candidate.version !== SETUP_DRAFT_VERSION) return null;
  if (!Array.isArray(candidate.courses) || !Array.isArray(candidate.classSections)) return null;
  const schedule = candidate.schedule ?? null;
  if (schedule !== null && schedule.mode !== "shared" && schedule.mode !== "own") return null;
  return {
    version: SETUP_DRAFT_VERSION,
    step: candidate.step ?? "teaching-day",
    courses: candidate.courses,
    classSections: candidate.classSections,
    schedule,
    lunchWave: candidate.lunchWave ?? "none",
    firstLesson: candidate.firstLesson ?? null,
  };
}

/** A shared schedule's periods as recorded in a draft - the exact value complete_setup() compares against the live schedule. */
export function snapshotSharedBlocks(schedule: BellSchedule): SharedBlockSnapshot[] {
  return schedule.blocks.map((block) => ({
    id: block.id,
    label: block.label,
    kind: block.kind,
    startTime: block.startTime,
    endTime: block.endTime,
  }));
}

/**
 * True when a draft's chosen shared schedule is missing, no longer usable,
 * or has different periods than the teacher was shown. The server makes the
 * authoritative version of this check at completion; this one lets the UI
 * notice on resume instead of only at the final step.
 */
export function hasSharedScheduleChanged(
  draftSchedule: Extract<SetupDraftSchedule, { mode: "shared" }>,
  schedules: BellSchedule[],
): boolean {
  const current = schedules.find((schedule) => schedule.id === draftSchedule.scheduleId);
  if (!current || !isUsableSharedSchedule(current)) return true;
  return !deepEqual(snapshotSharedBlocks(current), draftSchedule.expectedBlocks);
}

function sortBlocksChronologically<T extends { id: string; startTime: string }>(blocks: T[]): T[] {
  return [...blocks].sort(
    (a, b) => timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The private BellSchedule an "own" draft schedule becomes - blocks in chronological order, matching the positions complete_setup() assigns. */
export function ownScheduleToBellSchedule(schedule: Extract<SetupDraftSchedule, { mode: "own" }>): BellSchedule {
  return {
    id: schedule.id,
    name: schedule.name.trim(),
    ownerType: "teacher",
    isDefault: false,
    timeZone: schedule.timeZone,
    source: "custom",
    blocks: sortBlocksChronologically(schedule.blocks).map(
      (block): ScheduleBlock => ({
        id: block.id,
        label: block.label.trim(),
        kind: block.kind,
        customKindLabel: block.customKindLabel,
        startTime: block.startTime,
        endTime: block.endTime,
        classSectionId: block.classSectionId,
        overrides: [],
      }),
    ),
  };
}

export interface SetupDraftIssue {
  step: SetupStep;
  message: string;
}

/**
 * Everything standing between this draft and a successful completion.
 * Empty means ready. Mirrors complete_setup()'s own checks so a teacher is
 * told here rather than by a rejected submission, and adds the one product
 * rule the server leaves open: a prepared first lesson is required.
 *
 * `reference` is the teacher's existing readable data (organization
 * schedules and courses) - used only to resolve what the draft points at.
 */
export function validateSetupDraft(
  draft: SetupDraft,
  reference: Pick<AppData, "courses" | "schedules">,
): SetupDraftIssue[] {
  const issues: SetupDraftIssue[] = [];
  const sectionIds = new Set(draft.classSections.map((section) => section.id));
  const courseIds = new Set([...reference.courses, ...draft.courses].map((course) => course.id));

  if (draft.classSections.length === 0) {
    issues.push({ step: "teaching-day", message: "Add at least one class." });
  }
  if (draft.courses.some((course) => course.name.trim() === "")) {
    issues.push({ step: "teaching-day", message: "Every course needs a name." });
  }
  if (draft.classSections.some((section) => section.name.trim() === "")) {
    issues.push({ step: "teaching-day", message: "Every class needs a name." });
  }
  if (draft.classSections.some((section) => !courseIds.has(section.courseId))) {
    issues.push({ step: "teaching-day", message: "A class refers to a course that is not available." });
  }

  const schedule = draft.schedule;
  if (schedule === null) {
    issues.push({ step: "teaching-day", message: "Choose a schedule." });
  } else if (schedule.mode === "shared") {
    if (hasSharedScheduleChanged(schedule, reference.schedules)) {
      issues.push({ step: "teaching-day", message: "Your school's schedule has changed. Review your periods." });
    }
    const blockIds = new Set(schedule.expectedBlocks.map((block) => block.id));
    const assignments = schedule.assignments.filter(
      (assignment) => blockIds.has(assignment.blockId) && sectionIds.has(assignment.classSectionId),
    );
    if (assignments.length !== schedule.assignments.length) {
      issues.push({ step: "teaching-day", message: "A period assignment points at a class or period that no longer exists." });
    }
    if (assignments.length === 0) {
      issues.push({ step: "teaching-day", message: "Assign at least one class to a period." });
    }
  } else {
    if (schedule.name.trim() === "") {
      issues.push({ step: "teaching-day", message: "Name your schedule." });
    }
    if (schedule.blocks.length === 0) {
      issues.push({ step: "teaching-day", message: "Add at least one period to your schedule." });
    }
    if (schedule.blocks.some((block) => block.label.trim() === "")) {
      issues.push({ step: "teaching-day", message: "Every period needs a name." });
    }
    if (schedule.blocks.some((block) => block.classSectionId !== null && !sectionIds.has(block.classSectionId))) {
      issues.push({ step: "teaching-day", message: "A period is assigned to a class that no longer exists." });
    }
    if (!schedule.blocks.some((block) => block.classSectionId !== null)) {
      issues.push({ step: "teaching-day", message: "Assign at least one class to a period." });
    }
    // The existing Schedule Setup validator, unchanged. A private setup
    // schedule has no weekday overrides, so every weekday reports the same
    // problems - one weekday's worth is the whole set.
    for (const issue of validateSchedule(ownScheduleToBellSchedule(schedule))) {
      if (issue.weekday === "monday") {
        issues.push({ step: "teaching-day", message: issue.message.replace(/ on monday\.$/, ".") });
      }
    }
  }

  const lesson = draft.firstLesson;
  if (lesson === null || !sectionIds.has(lesson.classSectionId)) {
    issues.push({ step: "first-lesson", message: "Plan a first lesson for one of your classes." });
  } else if (getLessonPlanningStatus(draftLessonToDailyLesson(lesson, "")) !== "prepared") {
    issues.push({ step: "first-lesson", message: "Add a learning target or an agenda item to your first lesson." });
  }

  return issues;
}

function draftLessonToDailyLesson(lesson: NonNullable<SetupDraft["firstLesson"]>, timestamp: string): DailyLesson {
  return {
    id: lesson.id,
    date: lesson.date,
    classSectionId: lesson.classSectionId,
    learningTarget: lesson.learningTarget,
    agendaItems: lesson.agendaItems,
    resources: lesson.resources,
    announcements: lesson.announcements,
    materials: lesson.materials,
    warmup: lesson.warmup,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * The AppData this draft will produce once committed, layered on `base`
 * (the teacher's current readable data). Two uses, one definition:
 *
 * - Preview before completing: render the existing Present/Preview
 *   components against this value, read-only, without writing anything.
 * - Verification: after complete_setup(), a real load() must equal this
 *   (lesson timestamps aside) - see scripts/verify-onboarding-setup-db.ts.
 *
 * Never mutates `base`. `timestamp` stands in for the lesson's
 * createdAt/updatedAt, which the database assigns at commit.
 */
export function projectSetupDraftToAppData(draft: SetupDraft, base: AppData, timestamp: string): AppData {
  const schedule = draft.schedule;
  let schedules = base.schedules;
  let teacherPeriodAssignments = base.teacherPeriodAssignments;
  let activeBellScheduleId = base.teacherSchedulePreferences.activeBellScheduleId;

  if (schedule?.mode === "own") {
    schedules = [...base.schedules, ownScheduleToBellSchedule(schedule)];
    activeBellScheduleId = schedule.id;
  } else if (schedule?.mode === "shared") {
    const sectionByBlockId = new Map(schedule.assignments.map((a) => [a.blockId, a.classSectionId]));
    schedules = base.schedules.map((existing) =>
      existing.id === schedule.scheduleId
        ? {
            ...existing,
            blocks: existing.blocks.map((block) => ({
              ...block,
              classSectionId: sectionByBlockId.get(block.id) ?? block.classSectionId,
            })),
          }
        : existing,
    );
    teacherPeriodAssignments = [
      ...base.teacherPeriodAssignments,
      ...schedule.assignments.map((assignment) => ({
        id: assignment.id,
        scheduleId: schedule.scheduleId,
        blockId: assignment.blockId,
        overrideWeekday: null,
        classSectionId: assignment.classSectionId,
      })),
    ];
    activeBellScheduleId = schedule.scheduleId;
  }

  return {
    ...base,
    courses: [...base.courses, ...draft.courses.map((course) => ({ ...course, name: course.name.trim() }))],
    classSections: [
      ...base.classSections,
      ...draft.classSections.map((section) => ({ ...section, name: section.name.trim() })),
    ],
    schedules,
    teacherPeriodAssignments,
    teacherSchedulePreferences: { lunchWave: draft.lunchWave, activeBellScheduleId },
    lessons: draft.firstLesson
      ? [...base.lessons, draftLessonToDailyLesson(draft.firstLesson, timestamp)]
      : base.lessons,
  };
}
