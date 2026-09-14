import type { Course, ClassSection } from "@/types/course";
import type { AgendaItem, DailyLesson } from "@/types/lesson";
import { LESSON_IMPORT_SCHEMA_VERSION } from "@/types/lessonImport";
import { findLessonForSection } from "@/lib/data/lessons";
import { formatDateKeyLong } from "@/lib/schedule/localDate";

/**
 * Lesson import (Phase 1, JSON only): a small pure pipeline with zero side
 * effects, same shape as `lib/calendar/masterCalendarImport.ts` -
 *
 *   parseLessonImportJson -> validateImportedLessons ->
 *   buildLessonImportPreview (matches courses + detects conflicts) ->
 *   commitLessonImport (returns the complete new `lessons[]`) -> one
 *   `IMPORT_LESSONS` dispatch.
 *
 * Only the final dispatch (outside this module) ever touches AppData. This
 * is specifically a *lesson content* importer - it never creates courses
 * or class sections, never touches schedules/calendar/resources, and never
 * fuzzy-matches a course name.
 */

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export interface LessonImportRow {
  /** 1-indexed position in the file's `lessons` array - "Row N" in every message, matching how a teacher would count entries. */
  sourceRowNumber: number;
  date: string;
  course: string;
  learningTarget: string;
  what: string;
  how: string;
  why: string;
  materials: string;
}

export type LessonImportParseResult =
  | { ok: true; version: number; rows: LessonImportRow[] }
  | { ok: false; issues: string[] };

/** Parses a Phase 1 lesson import JSON file. Never throws - malformed JSON becomes an issue. */
export function parseLessonImportJson(raw: string): LessonImportParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, issues: ["That file isn't valid JSON."] };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, issues: ["Expected a JSON object at the top level, with \"version\" and \"lessons\"."] };
  }
  const root = data as Record<string, unknown>;

  const version = typeof root.version === "number" ? root.version : NaN;
  if (version !== LESSON_IMPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        Number.isFinite(version)
          ? `Falcon Deck doesn't support import version ${version} yet - this version of Falcon Deck supports version ${LESSON_IMPORT_SCHEMA_VERSION}.`
          : `This file is missing a supported "version" number (expected ${LESSON_IMPORT_SCHEMA_VERSION}).`,
      ],
    };
  }

  if (!Array.isArray(root.lessons)) {
    return { ok: false, issues: ["Expected a \"lessons\" list."] };
  }
  if (root.lessons.length === 0) {
    return { ok: false, issues: ["This file has no lessons to import."] };
  }

  const rows: LessonImportRow[] = root.lessons.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    return {
      sourceRowNumber: index + 1,
      date: asText(row.date),
      course: asText(row.course),
      learningTarget: asText(row.learningTarget),
      what: asText(row.what),
      how: asText(row.how),
      why: asText(row.why),
      materials: asText(row.materials),
    };
  });

  return { ok: true, version, rows };
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export interface LessonImportRowIssue {
  rowNumber: number;
  message: string;
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Row-level checks plus a whole-file duplicate check (same course + date
 * appearing twice). Messages are written for a teacher to read directly -
 * no field names, no stack traces.
 */
export function validateImportedLessons(rows: LessonImportRow[]): LessonImportRowIssue[] {
  const issues: LessonImportRowIssue[] = [];
  const firstRowByKey = new Map<string, number>();

  rows.forEach((row) => {
    if (!row.date) {
      issues.push({ rowNumber: row.sourceRowNumber, message: `Row ${row.sourceRowNumber} is missing a date.` });
    } else if (!isValidDateKey(row.date)) {
      issues.push({
        rowNumber: row.sourceRowNumber,
        message: `Row ${row.sourceRowNumber}: "${row.date}" isn't a valid date (expected YYYY-MM-DD).`,
      });
    }

    if (!row.course) {
      issues.push({ rowNumber: row.sourceRowNumber, message: `Row ${row.sourceRowNumber} is missing a course.` });
    }

    if (!row.learningTarget && !row.what && !row.how && !row.why && !row.materials) {
      issues.push({
        rowNumber: row.sourceRowNumber,
        message: `Row ${row.sourceRowNumber} has no lesson content (learning target, what/how/why, or materials).`,
      });
    }

    if (row.date && row.course && isValidDateKey(row.date)) {
      const key = `${row.date}|${row.course.toLowerCase()}`;
      const firstRow = firstRowByKey.get(key);
      if (firstRow !== undefined) {
        issues.push({
          rowNumber: row.sourceRowNumber,
          message: `${formatDateKeyLong(row.date)} appears twice for ${row.course}.`,
        });
      } else {
        firstRowByKey.set(key, row.sourceRowNumber);
      }
    }
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Match courses
// ---------------------------------------------------------------------------

export interface MatchedLessonRow {
  row: LessonImportRow;
  /** `null` when no existing Course's name matches - never auto-created, never fuzzy-corrected. */
  courseId: string | null;
}

/** Case/whitespace-insensitive key an imported course name is looked up by - shared by matching and the manual-mapping UI so both agree on what counts as "the same name". */
export function normalizeCourseNameKey(courseName: string): string {
  return courseName.trim().toLowerCase();
}

/**
 * Matches an imported course name against an existing Course, exact and
 * case-insensitive only - never fuzzy. `courseNameOverrides` (keyed by
 * `normalizeCourseNameKey`) is the one exception: a teacher's own explicit
 * "map this name to this course" choice, made once in the review UI and
 * applied to every row that used the same unmatched name. This is manual
 * correction, not automatic fuzzy correction - the teacher picks the
 * course, Falcon Deck never guesses.
 */
export function matchImportedCourses(
  rows: LessonImportRow[],
  courses: Course[],
  courseNameOverrides: Record<string, string> = {},
): MatchedLessonRow[] {
  return rows.map((row) => {
    if (!row.course) return { row, courseId: null };
    const needle = normalizeCourseNameKey(row.course);
    const automaticMatch = courses.find((course) => normalizeCourseNameKey(course.name) === needle);
    if (automaticMatch) return { row, courseId: automaticMatch.id };

    const overrideId = courseNameOverrides[needle];
    const overrideCourse = overrideId ? courses.find((course) => course.id === overrideId) : undefined;
    return { row, courseId: overrideCourse?.id ?? null };
  });
}

// ---------------------------------------------------------------------------
// What/How/Why -> agenda items
// ---------------------------------------------------------------------------

const WHAT_HOW_WHY_TITLES = {
  what: "What We're Learning",
  how: "How We'll Get There",
  why: "Why It Matters",
} as const;

/** Only the non-empty of what/how/why become agenda items, in that fixed order. */
export function buildAgendaItemsFromRow(
  row: Pick<LessonImportRow, "what" | "how" | "why">,
  generateId: (prefix: string) => string,
): AgendaItem[] {
  const entries: Array<[keyof typeof WHAT_HOW_WHY_TITLES, string]> = [
    ["what", row.what],
    ["how", row.how],
    ["why", row.why],
  ];
  return entries
    .filter(([, text]) => text.length > 0)
    .map(([key, text], index) => ({
      id: generateId("agenda"),
      title: WHAT_HOW_WHY_TITLES[key],
      details: text,
      isCompleted: false,
      sortOrder: index,
    }));
}

// ---------------------------------------------------------------------------
// Preview (validate + match + conflict-detect, combined for the UI)
// ---------------------------------------------------------------------------

export type LessonImportRowKind = "invalid" | "unmatched-course" | "no-active-sections" | "ready";

export interface LessonImportRowPreview {
  rowIndex: number;
  row: LessonImportRow;
  kind: LessonImportRowKind;
  /** Populated only for `kind === "invalid"`. */
  issues: string[];
  courseId: string | null;
  /** Every active ClassSection this row would write to - populated for "ready" only. */
  sectionIds: string[];
  /** True if any of `sectionIds` already has a lesson for this date - "ready" only. */
  conflict: boolean;
  conflictingSectionIds: string[];
}

export interface LessonImportPreview {
  totalRows: number;
  readyCount: number;
  conflictCount: number;
  invalidCount: number;
  unmatchedCourseCount: number;
  rows: LessonImportRowPreview[];
}

export function buildLessonImportPreview(
  rows: LessonImportRow[],
  courses: Course[],
  classSections: ClassSection[],
  existingLessons: DailyLesson[],
  /** Keyed by `normalizeCourseNameKey` - a teacher's manual "map this unmatched name to this course" choices from the review UI. */
  courseNameOverrides: Record<string, string> = {},
): LessonImportPreview {
  const issuesByRow = new Map<number, string[]>();
  for (const issue of validateImportedLessons(rows)) {
    const list = issuesByRow.get(issue.rowNumber) ?? [];
    list.push(issue.message);
    issuesByRow.set(issue.rowNumber, list);
  }

  const rowPreviews: LessonImportRowPreview[] = matchImportedCourses(rows, courses, courseNameOverrides).map(
    ({ row, courseId }, rowIndex) => {
      const issues = issuesByRow.get(row.sourceRowNumber) ?? [];
      const base = { rowIndex, row, issues, courseId, sectionIds: [], conflict: false, conflictingSectionIds: [] };

      if (issues.length > 0) return { ...base, kind: "invalid" as const };
      if (!courseId) return { ...base, kind: "unmatched-course" as const };

      const sectionIds = classSections.filter((section) => section.courseId === courseId).map((s) => s.id);
      if (sectionIds.length === 0) return { ...base, kind: "no-active-sections" as const, courseId };

      const conflictingSectionIds = sectionIds.filter(
        (sectionId) => findLessonForSection(existingLessons, row.date, sectionId) !== null,
      );
      return {
        ...base,
        kind: "ready" as const,
        courseId,
        sectionIds,
        conflict: conflictingSectionIds.length > 0,
        conflictingSectionIds,
      };
    },
  );

  return {
    totalRows: rows.length,
    readyCount: rowPreviews.filter((r) => r.kind === "ready").length,
    conflictCount: rowPreviews.filter((r) => r.kind === "ready" && r.conflict).length,
    invalidCount: rowPreviews.filter((r) => r.kind === "invalid").length,
    unmatchedCourseCount: rowPreviews.filter((r) => r.kind === "unmatched-course" || r.kind === "no-active-sections")
      .length,
    rows: rowPreviews,
  };
}

// ---------------------------------------------------------------------------
// Commit (still pure - produces the complete new `lessons[]`; the caller dispatches it)
// ---------------------------------------------------------------------------

export type LessonImportConflictResolution = "skip" | "replace" | "merge";

export type LessonImportRowOutcome = "imported" | "replaced" | "merged" | "skipped";

export interface LessonImportRowResult {
  rowIndex: number;
  outcome: LessonImportRowOutcome;
  sectionIds: string[];
}

export interface CommitLessonImportResult {
  lessons: DailyLesson[];
  results: LessonImportRowResult[];
}

/**
 * Builds the complete new `lessons[]` array (existing lessons untouched
 * except where a row's chosen resolution says otherwise) plus a per-row
 * outcome for the Results step. Only "ready" preview rows are considered -
 * invalid/unmatched/no-section rows were never eligible and are silently
 * absent from `results`, matching what the teacher saw and confirmed on
 * the Preview step.
 *
 * Idempotent by construction: re-running this against a `lessons[]` that
 * already contains a prior import's output makes every previously-created
 * row look like an existing lesson again (found via `findLessonForSection`
 * -> `conflict: true` in the preview that fed this), so a retry with the
 * default "skip" resolution changes nothing, and an explicit "replace"/
 * "merge" updates the same id in place rather than pushing a duplicate.
 *
 * Only fields the import format actually represents (learningTarget,
 * agenda items derived from what/how/why, materials) are ever written -
 * `resources`/`announcements` are always carried over from any existing
 * lesson untouched, since the import file has no way to express or intend
 * removing a teacher's manually-attached links or announcements.
 */
export function commitLessonImport({
  preview,
  resolutions,
  existingLessons,
  generateId,
  now,
}: {
  preview: LessonImportPreview;
  /** Keyed by `rowIndex`; only consulted for rows where `conflict` is true. Defaults to "skip" (the required default). */
  resolutions: Record<number, LessonImportConflictResolution>;
  existingLessons: DailyLesson[];
  generateId: (prefix: string) => string;
  now: () => string;
}): CommitLessonImportResult {
  let lessons = existingLessons;
  const results: LessonImportRowResult[] = [];

  for (const rowPreview of preview.rows) {
    if (rowPreview.kind !== "ready") continue;

    const resolution: LessonImportConflictResolution = rowPreview.conflict
      ? (resolutions[rowPreview.rowIndex] ?? "skip")
      : "replace"; // nothing exists yet anywhere for this row - a plain create, reported as "imported" below

    if (resolution === "skip") {
      results.push({ rowIndex: rowPreview.rowIndex, outcome: "skipped", sectionIds: rowPreview.sectionIds });
      continue;
    }

    const timestamp = now();
    for (const sectionId of rowPreview.sectionIds) {
      const existing = findLessonForSection(lessons, rowPreview.row.date, sectionId);

      if (resolution === "merge" && existing) {
        const merged: DailyLesson = {
          ...existing,
          learningTarget: existing.learningTarget.trim() ? existing.learningTarget : rowPreview.row.learningTarget,
          agendaItems:
            existing.agendaItems.length > 0
              ? existing.agendaItems
              : buildAgendaItemsFromRow(rowPreview.row, generateId),
          materials: existing.materials?.trim() ? existing.materials : rowPreview.row.materials || undefined,
          updatedAt: timestamp,
        };
        lessons = lessons.map((lesson) => (lesson.id === merged.id ? merged : lesson));
      } else {
        const next: DailyLesson = {
          id: existing ? existing.id : generateId("lesson"),
          date: rowPreview.row.date,
          classSectionId: sectionId,
          learningTarget: rowPreview.row.learningTarget,
          agendaItems: buildAgendaItemsFromRow(rowPreview.row, generateId),
          resources: existing?.resources ?? [],
          announcements: existing?.announcements ?? [],
          materials: rowPreview.row.materials || undefined,
          createdAt: existing ? existing.createdAt : timestamp,
          updatedAt: timestamp,
        };
        lessons = existing ? lessons.map((lesson) => (lesson.id === next.id ? next : lesson)) : [...lessons, next];
      }
    }

    results.push({
      rowIndex: rowPreview.rowIndex,
      outcome: rowPreview.conflict ? (resolution === "replace" ? "replaced" : "merged") : "imported",
      sectionIds: rowPreview.sectionIds,
    });
  }

  return { lessons, results };
}
