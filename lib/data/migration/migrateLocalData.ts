import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/supabase.types";
import type { AppData } from "@/lib/data/types";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import * as Map_ from "@/lib/data/supabaseMapping";

type Client = SupabaseClient<Database>;

export interface MigrationCounts {
  courses: number;
  classSections: number;
  bellSchedules: number;
  scheduleBlocks: number;
  scheduleBlockOverrides: number;
  schoolYearCalendars: number;
  schoolCalendarExceptions: number;
  lessons: number;
  lessonClassSections: number;
  libraryResources: number;
  libraryResourceCourseLinks: number;
  classPresentationSettings: number;
  classroomExperienceSettings: number;
  teacherSchedulePreferences: number;
}

const EMPTY_COUNTS: MigrationCounts = {
  courses: 0,
  classSections: 0,
  bellSchedules: 0,
  scheduleBlocks: 0,
  scheduleBlockOverrides: 0,
  schoolYearCalendars: 0,
  schoolCalendarExceptions: 0,
  lessons: 0,
  lessonClassSections: 0,
  libraryResources: 0,
  libraryResourceCourseLinks: 0,
  classPresentationSettings: 0,
  classroomExperienceSettings: 0,
  teacherSchedulePreferences: 0,
};

export interface MigrationWarning {
  code: "watermark-not-migrated" | "lesson-unresolvable-course" | "unresolvable-reference";
  message: string;
}

export type MigrationResult =
  | { ok: true; alreadyMigrated: false; counts: MigrationCounts; warnings: MigrationWarning[] }
  | { ok: false; alreadyMigrated: true; counts: null; warnings: [] }
  | { ok: false; alreadyMigrated: false; error: string; counts: MigrationCounts; warnings: MigrationWarning[] };

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

/**
 * One-time localStorage -> Supabase importer for a single authenticated
 * teacher. Deliberately separate from SupabaseDataRepository.save() (see
 * Decision 4) - this does its own direct, dependency-ordered upserts rather
 * than going through save()'s diff logic, because a migration's shape
 * (write everything once) and a normal save's shape (write only what
 * changed since the last snapshot) are different concerns that don't
 * belong in one code path.
 *
 * Never touches localStorage - `snapshot` is passed in by the caller, which
 * is responsible for having already read it (and, per the milestone's
 * requirement, already built+saved a downloadBackup of it) before calling
 * this.
 *
 * Idempotent: every table is upserted keyed on the preserved local id (or,
 * for the id-less join tables, on their natural composite key), so calling
 * this again with the same snapshot re-writes the same rows rather than
 * duplicating them. Safe to retry after a partial failure for exactly that
 * reason - see docs on the SPECIAL CASE section below for the one
 * transitional exception (the calendar, which is organization-scoped and
 * gated on the caller holding role='admin').
 */
export async function migrateLocalData(client: Client, ctx: OwnerContext, snapshot: AppData): Promise<MigrationResult> {
  const membership = unwrap<{ local_data_migrated_at: string | null }>(
    await client.from("organization_memberships").select("local_data_migrated_at").eq("id", ctx.membershipId).single(),
    "read organization_memberships",
  );

  if (membership.local_data_migrated_at !== null) {
    return { ok: false, alreadyMigrated: true, counts: null, warnings: [] };
  }

  const counts: MigrationCounts = { ...EMPTY_COUNTS };
  const warnings: MigrationWarning[] = [];

  try {
    // 1. courses (teacher-owned)
    if (snapshot.courses.length > 0) {
      unwrap(
        await client.from("courses").upsert(snapshot.courses.map((c) => Map_.courseToRow(c, ctx))),
        "migrate courses",
      );
      counts.courses = snapshot.courses.length;
    }

    // 2. class_sections
    if (snapshot.classSections.length > 0) {
      unwrap(
        await client.from("class_sections").upsert(snapshot.classSections.map((s) => Map_.classSectionToRow(s, ctx))),
        "migrate class_sections",
      );
      counts.classSections = snapshot.classSections.length;
    }

    // 3-5. bell_schedules -> schedule_blocks -> schedule_block_overrides.
    //
    // SPECIAL CASE - built-in schedules (per approved Decision 1 and
    // V2_ARCHITECTURE.md's Gap #1: no canonical organization schedule
    // exists yet for any newly-bootstrapped organization). Every local
    // schedule, including one tagged `source: "built-in"`, is materialized
    // here as teacher-owned data (owner_type='teacher') - its blocks,
    // times, and overrides are preserved exactly as the teacher currently
    // has them. This is transitional: once a later, separate milestone
    // introduces real organization-owned canonical schedules, a
    // reconciliation step (matching by content, per
    // docs/V2_DATABASE_SCHEMA.md §9/§10) can be layered on top - nothing
    // here promotes or overwrites organization-level configuration, and
    // nothing here needs to change when that milestone lands.
    if (snapshot.schedules.length > 0) {
      unwrap(
        await client.from("bell_schedules").upsert(snapshot.schedules.map((s) => Map_.bellScheduleToRow(s, ctx))),
        "migrate bell_schedules",
      );
      counts.bellSchedules = snapshot.schedules.length;

      const allBlocks = snapshot.schedules.flatMap((schedule) =>
        schedule.blocks.map((block, position) => Map_.scheduleBlockToRow(block, position, schedule.id, ctx)),
      );
      if (allBlocks.length > 0) {
        unwrap(await client.from("schedule_blocks").upsert(allBlocks), "migrate schedule_blocks");
        counts.scheduleBlocks = allBlocks.length;
      }

      const allOverrides = snapshot.schedules.flatMap((schedule) =>
        schedule.blocks.flatMap((block) =>
          block.overrides.map((override) => Map_.scheduleBlockOverrideToRow(override, block.id, ctx)),
        ),
      );
      if (allOverrides.length > 0) {
        unwrap(await client.from("schedule_block_overrides").upsert(allOverrides), "migrate schedule_block_overrides");
        counts.scheduleBlockOverrides = allOverrides.length;
      }
    }

    // 6-7. school_year_calendars -> school_calendar_exceptions.
    //
    // Per the corrective dual-ownership migration
    // (20260915000000_school_year_calendars_dual_ownership.sql),
    // school_year_calendars now supports owner_type='teacher' the same way
    // courses/bell_schedules do - every teacher can migrate their own
    // calendar, not just an organization admin. Written with
    // owner_type='teacher', owner_membership_id=ctx.membershipId, and
    // is_canonical=false (Decision 1 - never promoted to the
    // organization's canonical calendar).
    if (snapshot.schoolCalendar) {
      unwrap(
        await client.from("school_year_calendars").upsert(Map_.schoolYearCalendarToRow(snapshot.schoolCalendar, ctx)),
        "migrate school_year_calendars",
      );
      counts.schoolYearCalendars = 1;

      const exceptions = snapshot.schoolCalendar.exceptions;
      if (exceptions.length > 0) {
        unwrap(
          await client
            .from("school_calendar_exceptions")
            .upsert(exceptions.map((e) => Map_.schoolCalendarExceptionToRow(e, snapshot.schoolCalendar!.id, ctx))),
          "migrate school_calendar_exceptions",
        );
        counts.schoolCalendarExceptions = exceptions.length;
      }
    }

    // 8-9. lessons -> lesson_class_sections.
    if (snapshot.lessons.length > 0) {
      const migratable: typeof snapshot.lessons = [];
      for (const lesson of snapshot.lessons) {
        const section = snapshot.classSections.find((s) => s.id === lesson.classSectionId);
        if (!section) {
          warnings.push({
            code: "lesson-unresolvable-course",
            message: `Lesson ${lesson.id} (date ${lesson.date}) references classSectionId ${lesson.classSectionId}, which no longer exists locally. Skipped - not migrated, not deleted locally.`,
          });
          continue;
        }
        migratable.push(lesson);
      }
      if (migratable.length > 0) {
        const courseIdFor = (lesson: (typeof migratable)[number]) =>
          snapshot.classSections.find((s) => s.id === lesson.classSectionId)!.courseId;
        unwrap(
          await client
            .from("lessons")
            .upsert(migratable.map((lesson) => Map_.lessonToRow(lesson, courseIdFor(lesson), ctx))),
          "migrate lessons",
        );
        counts.lessons = migratable.length;
        unwrap(
          await client
            .from("lesson_class_sections")
            .upsert(migratable.map((lesson) => Map_.lessonClassSectionToRow(lesson, ctx))),
          "migrate lesson_class_sections",
        );
        counts.lessonClassSections = migratable.length;
      }
    }

    // 10-11. library_resources -> library_resource_courses.
    if (snapshot.libraryResources.length > 0) {
      unwrap(
        await client
          .from("library_resources")
          .upsert(snapshot.libraryResources.map((r) => Map_.libraryResourceToRow(r, ctx))),
        "migrate library_resources",
      );
      counts.libraryResources = snapshot.libraryResources.length;

      const links = snapshot.libraryResources.flatMap((resource) =>
        resource.courseIds.map((courseId) => Map_.libraryResourceCourseToRow(resource.id, courseId, ctx)),
      );
      if (links.length > 0) {
        unwrap(await client.from("library_resource_courses").upsert(links), "migrate library_resource_courses");
        counts.libraryResourceCourseLinks = links.length;
      }
    }

    // 12. class_presentation_settings
    if (snapshot.classPresentationSettings.length > 0) {
      unwrap(
        await client
          .from("class_presentation_settings")
          .upsert(snapshot.classPresentationSettings.map((s) => Map_.classPresentationSettingsToRow(s, ctx))),
        "migrate class_presentation_settings",
      );
      counts.classPresentationSettings = snapshot.classPresentationSettings.length;
    }

    // 13. classroom_experience_settings.
    //
    // customWatermarkDataUrl (a base64 data: URL) is never written here -
    // Supabase Storage upload is a separate, not-yet-built subsystem. This
    // is reported, not silently dropped: the local data: URL stays exactly
    // where it is (localStorage, untouched), and this warning says so
    // explicitly.
    unwrap(
      await client
        .from("classroom_experience_settings")
        .upsert(Map_.classroomExperienceSettingsToRow(snapshot.classroomExperienceSettings, ctx)),
      "migrate classroom_experience_settings",
    );
    counts.classroomExperienceSettings = 1;
    if (snapshot.classroomExperienceSettings.customWatermarkDataUrl) {
      warnings.push({
        code: "watermark-not-migrated",
        message:
          "A custom Present Mode watermark image exists locally but Supabase Storage upload is not implemented yet. The watermark was not migrated; the local image is untouched.",
      });
    }

    // 14. teacher_schedule_preferences
    unwrap(
      await client
        .from("teacher_schedule_preferences")
        .upsert(Map_.teacherSchedulePreferencesToRow(snapshot.teacherSchedulePreferences, ctx)),
      "migrate teacher_schedule_preferences",
    );
    counts.teacherSchedulePreferences = 1;

    return { ok: true, alreadyMigrated: false, counts, warnings };
  } catch (error) {
    return {
      ok: false,
      alreadyMigrated: false,
      error: error instanceof Error ? error.message : "Unknown migration error.",
      counts,
      warnings,
    };
  }
}

/**
 * Writes organization_memberships.local_data_migrated_at - the single
 * source of truth for "has this user already migrated" (Decision 3). Must
 * only be called after validateMigratedData confirms full parity; never
 * called from migrateLocalData itself.
 */
export async function markMigrationComplete(client: Client, membershipId: string): Promise<void> {
  unwrap(
    await client
      .from("organization_memberships")
      .update({ local_data_migrated_at: new Date().toISOString() })
      .eq("id", membershipId),
    "mark migration complete",
  );
}
