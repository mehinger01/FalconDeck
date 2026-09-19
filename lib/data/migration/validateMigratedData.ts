import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/supabase.types";
import type { AppData } from "@/lib/data/types";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import { fetchAppData } from "@/lib/data/supabaseDataRepository";
import { deepEqual } from "@/lib/data/supabaseMapping";
import type { MigrationResult } from "./migrateLocalData";

type Client = SupabaseClient<Database>;

export interface EntityMismatch {
  entity: string;
  detail: string;
}

export type ValidationResult =
  | { ok: true; mismatches: [] }
  | { ok: false; mismatches: EntityMismatch[] };

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Deep-clones and sorts every array-of-objects field by a stable key, so
 * two AppData objects that differ only in fetch/array ordering compare
 * equal. Nothing here changes any *value* - only the order comparisons
 * are performed in.
 */
function normalize(data: AppData): AppData {
  const clone = structuredClone(data);
  clone.courses = sortById(clone.courses);
  clone.classSections = sortById(clone.classSections);
  clone.schedules = sortById(clone.schedules).map((schedule) => ({
    ...schedule,
    blocks: sortById(schedule.blocks).map((block) => ({
      ...block,
      overrides: [...block.overrides].sort((a, b) => a.weekday.localeCompare(b.weekday)),
    })),
  }));
  clone.lessons = sortById(clone.lessons);
  clone.libraryResources = sortById(clone.libraryResources).map((resource) => ({
    ...resource,
    courseIds: [...resource.courseIds].sort(),
  }));
  clone.classPresentationSettings = [...clone.classPresentationSettings].sort((a, b) =>
    a.classSectionId.localeCompare(b.classSectionId),
  );
  if (clone.schoolCalendar) {
    clone.schoolCalendar = { ...clone.schoolCalendar, exceptions: sortById(clone.schoolCalendar.exceptions) };
  }
  return clone;
}

function diffEntityById<T extends { id: string }>(entity: string, expected: T[], actual: T[]): EntityMismatch[] {
  const mismatches: EntityMismatch[] = [];
  const expectedById = new Map(expected.map((item) => [item.id, item]));
  const actualById = new Map(actual.map((item) => [item.id, item]));
  for (const [id, item] of expectedById) {
    const found = actualById.get(id);
    if (!found) {
      mismatches.push({ entity, detail: `id ${id}: expected but missing after migration` });
    } else if (!deepEqual(item, found)) {
      mismatches.push({ entity, detail: `id ${id}: content differs after migration` });
    }
  }
  for (const id of actualById.keys()) {
    if (!expectedById.has(id)) {
      mismatches.push({ entity, detail: `id ${id}: present after migration but not in the original snapshot` });
    }
  }
  return mismatches;
}

/**
 * Reads Supabase back through the exact same fetchAppData() path a real
 * load() uses (never a separate/looser query), then compares substantive
 * field content against the original local snapshot - never just row
 * counts, per the milestone's explicit requirement. `migrationResult`
 * supplies the *expected* deviations (skipped lessons, the never-migrated
 * watermark) so those don't get reported as false mismatches - anything
 * not covered by an explicit warning must match exactly. Since the
 * corrective dual-ownership migration
 * (20260915000000_school_year_calendars_dual_ownership.sql),
 * school_year_calendars supports owner_type='teacher', so a local calendar
 * is always migrated (no admin gating, no skip case) - schoolCalendar is
 * therefore always expected to match exactly, unconditionally.
 */
export async function validateMigratedData(
  client: Client,
  ctx: OwnerContext,
  originalSnapshot: AppData,
  migrationResult: Extract<MigrationResult, { ok: true }>,
): Promise<ValidationResult> {
  const reloaded = await fetchAppData(client, ctx);

  const skippedLessonIds = new Set(
    migrationResult.warnings
      .filter((w) => w.code === "lesson-unresolvable-course")
      .map((w) => w.message.match(/^Lesson (\S+)/)?.[1])
      .filter((id): id is string => Boolean(id)),
  );

  const expected: AppData = {
    ...structuredClone(originalSnapshot),
    lessons: originalSnapshot.lessons.filter((lesson) => !skippedLessonIds.has(lesson.id)),
    classroomExperienceSettings: {
      ...originalSnapshot.classroomExperienceSettings,
      // Never round-trips in this phase - see migrateLocalData's
      // watermark-not-migrated warning. Expected to differ, not a defect.
      customWatermarkDataUrl: undefined,
    },
  };

  const expectedNormalized = normalize(expected);
  const actualNormalized = normalize(reloaded);

  const mismatches: EntityMismatch[] = [
    ...diffEntityById("courses", expectedNormalized.courses, actualNormalized.courses),
    ...diffEntityById("classSections", expectedNormalized.classSections, actualNormalized.classSections),
    ...diffEntityById("schedules", expectedNormalized.schedules, actualNormalized.schedules),
    ...diffEntityById("lessons", expectedNormalized.lessons, actualNormalized.lessons),
    ...diffEntityById("libraryResources", expectedNormalized.libraryResources, actualNormalized.libraryResources),
  ];

  const presentationExpected = new Map(expectedNormalized.classPresentationSettings.map((s) => [s.classSectionId, s]));
  const presentationActual = new Map(actualNormalized.classPresentationSettings.map((s) => [s.classSectionId, s]));
  for (const [id, item] of presentationExpected) {
    const found = presentationActual.get(id);
    if (!found) mismatches.push({ entity: "classPresentationSettings", detail: `classSectionId ${id}: expected but missing` });
    else if (!deepEqual(item, found))
      mismatches.push({ entity: "classPresentationSettings", detail: `classSectionId ${id}: content differs` });
  }
  for (const id of presentationActual.keys()) {
    if (!presentationExpected.has(id))
      mismatches.push({ entity: "classPresentationSettings", detail: `classSectionId ${id}: present but not expected` });
  }

  if (!deepEqual(expectedNormalized.classroomExperienceSettings, actualNormalized.classroomExperienceSettings)) {
    mismatches.push({ entity: "classroomExperienceSettings", detail: "content differs after migration" });
  }
  if (!deepEqual(expectedNormalized.teacherSchedulePreferences, actualNormalized.teacherSchedulePreferences)) {
    mismatches.push({ entity: "teacherSchedulePreferences", detail: "content differs after migration" });
  }
  if (!deepEqual(expectedNormalized.schoolCalendar, actualNormalized.schoolCalendar)) {
    mismatches.push({ entity: "schoolCalendar", detail: "content differs after migration" });
  }

  return mismatches.length === 0 ? { ok: true, mismatches: [] } : { ok: false, mismatches };
}
