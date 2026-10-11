import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase.types";
import type { AppData, DataRepository, ExternalChangeEvent, SaveResult } from "./types";
import type { OwnerContext } from "./supabaseMapping";
import * as Map_ from "./supabaseMapping";
import type { ClassSection } from "@/types/course";
import type { BellSchedule } from "@/types/schedule";
import type { DailyLesson } from "@/types/lesson";
import type { LibraryResource } from "@/types/resource";

type Client = SupabaseClient<Database>;

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

/**
 * Fetches every owner-scoped table and reconstructs the exact AppData shape
 * the rest of the app already expects. Exported so
 * lib/data/migration/validateMigratedData.ts can read back through the same
 * path a real load() would use, rather than duplicating query logic.
 */
export async function fetchAppData(client: Client, ctx: OwnerContext): Promise<AppData> {
  const [
    coursesRes,
    classSectionsRes,
    bellSchedulesRes,
    scheduleBlocksRes,
    overridesRes,
    assignmentsRes,
    calendarsRes,
    lessonsRes,
    lessonSectionsRes,
    libraryResourcesRes,
    libraryResourceCoursesRes,
    presentationRes,
    experienceRes,
    prefsRes,
    transitionOverridesRes,
  ] = await Promise.all([
    client.from("courses").select("*").eq("organization_id", ctx.organizationId),
    client.from("class_sections").select("*").eq("owner_membership_id", ctx.membershipId),
    client.from("bell_schedules").select("*").eq("organization_id", ctx.organizationId),
    client.from("schedule_blocks").select("*").eq("organization_id", ctx.organizationId),
    client.from("schedule_block_overrides").select("*").eq("organization_id", ctx.organizationId),
    client.from("teacher_period_assignments").select("*").eq("owner_membership_id", ctx.membershipId),
    client
      .from("school_year_calendars")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("is_canonical", { ascending: false })
      .order("created_at", { ascending: false }),
    client.from("lessons").select("*").eq("owner_membership_id", ctx.membershipId),
    client.from("lesson_class_sections").select("*").eq("owner_membership_id", ctx.membershipId),
    client.from("library_resources").select("*").eq("owner_membership_id", ctx.membershipId),
    client.from("library_resource_courses").select("*").eq("owner_membership_id", ctx.membershipId),
    client.from("class_presentation_settings").select("*").eq("owner_membership_id", ctx.membershipId),
    client.from("classroom_experience_settings").select("*").eq("owner_membership_id", ctx.membershipId).maybeSingle(),
    client.from("teacher_schedule_preferences").select("*").eq("owner_membership_id", ctx.membershipId).maybeSingle(),
    // Leaf table, no schedule dependency at all (see transition_overrides'
    // own migration comment) - fetched independently of
    // bell_schedules/schedule_blocks, same as teacher_period_assignments.
    client.from("transition_overrides").select("*").eq("owner_membership_id", ctx.membershipId),
  ]);

  const courses = unwrap(coursesRes, "load courses");
  const classSectionRows = unwrap(classSectionsRes, "load class_sections");
  const bellSchedules = unwrap(bellSchedulesRes, "load bell_schedules");
  const blocks = unwrap(scheduleBlocksRes, "load schedule_blocks");
  const overrides = unwrap(overridesRes, "load schedule_block_overrides");
  const assignments = unwrap(assignmentsRes, "load teacher_period_assignments");
  const calendars = unwrap(calendarsRes, "load school_year_calendars");
  const lessons = unwrap(lessonsRes, "load lessons");
  const lessonSections = unwrap(lessonSectionsRes, "load lesson_class_sections");
  const libraryResources = unwrap(libraryResourcesRes, "load library_resources");
  const libraryResourceCourses = unwrap(libraryResourceCoursesRes, "load library_resource_courses");
  const presentationSettings = unwrap(presentationRes, "load class_presentation_settings");
  // An empty table (or a brand-new teacher with none yet) unwraps to `[]`
  // via the same unwrap() every other table already uses - no special
  // "missing table" branch, no auto-creation.
  const transitionOverrideRows = unwrap(transitionOverridesRes, "load transition_overrides");

  const overridesByBlockId = new Map<string, typeof overrides>();
  for (const override of overrides) {
    const list = overridesByBlockId.get(override.schedule_block_id) ?? [];
    list.push(override);
    overridesByBlockId.set(override.schedule_block_id, list);
  }

  const assignedSectionByBlockId = new Map<string, string | null>();
  for (const assignment of assignments) {
    if (assignment.override_weekday === null) {
      assignedSectionByBlockId.set(assignment.schedule_block_id, assignment.class_section_id);
    }
  }

  const blocksByScheduleId = new Map<string, typeof blocks>();
  for (const block of blocks) {
    const list = blocksByScheduleId.get(block.bell_schedule_id) ?? [];
    list.push(block);
    blocksByScheduleId.set(block.bell_schedule_id, list);
  }

  const schedules: BellSchedule[] = bellSchedules.map((schedule) =>
    Map_.rowsToBellSchedule(
      schedule,
      blocksByScheduleId.get(schedule.id) ?? [],
      overridesByBlockId,
      assignedSectionByBlockId,
    ),
  );

  const canonicalCalendarRow = calendars[0] ?? null;
  let schoolCalendar = null;
  if (canonicalCalendarRow) {
    const exceptionsRes = await client
      .from("school_calendar_exceptions")
      .select("*")
      .eq("school_year_calendar_id", canonicalCalendarRow.id);
    const exceptions = unwrap(exceptionsRes, "load school_calendar_exceptions");
    schoolCalendar = Map_.rowsToSchoolYearCalendar(canonicalCalendarRow, exceptions);
  }

  const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const dailyLessons: DailyLesson[] = lessonSections
    .map((section) => {
      const lesson = lessonsById.get(section.lesson_id);
      return lesson ? Map_.rowsToDailyLesson(lesson, section) : null;
    })
    .filter((lesson): lesson is DailyLesson => lesson !== null);

  const courseIdsByResourceId = new Map<string, string[]>();
  for (const link of libraryResourceCourses) {
    const list = courseIdsByResourceId.get(link.library_resource_id) ?? [];
    list.push(link.course_id);
    courseIdsByResourceId.set(link.library_resource_id, list);
  }
  const resources: LibraryResource[] = libraryResources.map((resource) =>
    Map_.rowsToLibraryResource(resource, courseIdsByResourceId.get(resource.id) ?? []),
  );

  const classSections: ClassSection[] = classSectionRows.map(Map_.rowToClassSection);

  // Stage E: the exact same `assignments` rows already fetched above (no
  // duplicate query) - both the base-only merge into assignedSectionByBlockId
  // (used for the org-owned schedule blocks' classSectionId above) AND this
  // full collection (base + any pre-existing weekday-specific rows,
  // untouched) are derived from one fetch.
  const teacherPeriodAssignments = assignments.map(Map_.rowToTeacherPeriodAssignment);

  return {
    courses: courses.map(Map_.rowToCourse),
    classSections,
    schedules,
    lessons: dailyLessons,
    classPresentationSettings: presentationSettings.map(Map_.rowToClassPresentationSettings),
    classroomExperienceSettings: Map_.rowToClassroomExperienceSettings(unwrap(experienceRes, "load classroom_experience_settings")),
    libraryResources: resources,
    teacherSchedulePreferences: Map_.rowToTeacherSchedulePreferences(unwrap(prefsRes, "load teacher_schedule_preferences")),
    schoolCalendar,
    teacherPeriodAssignments,
    transitionOverrides: transitionOverrideRows.map(Map_.rowToTransitionOverride),
  };
}

// ---------------------------------------------------------------------------
// save() - snapshot diffing
// ---------------------------------------------------------------------------

interface Keyed {
  id: string;
}

function diffById<T extends Keyed>(prev: T[], next: T[]): { added: T[]; updated: T[]; removedIds: string[] } {
  const prevById = new Map(prev.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const added: T[] = [];
  const updated: T[] = [];
  for (const item of next) {
    const prior = prevById.get(item.id);
    if (!prior) added.push(item);
    else if (!Map_.deepEqual(prior, item)) updated.push(item);
  }
  const removedIds = prev.filter((item) => !nextById.has(item.id)).map((item) => item.id);
  return { added, updated, removedIds };
}

/**
 * Applies exactly the rows that changed between `prev` and `next`, in two
 * passes: deletes in child-before-parent order, then upserts in
 * parent-before-child order. Throws on the first failure - the caller
 * (SupabaseDataRepository.save) is responsible for not advancing its
 * snapshot when that happens, per Decision 2.
 */
export async function applyDiff(client: Client, ctx: OwnerContext, prev: AppData, next: AppData): Promise<void> {
  const courseDiff = diffById(prev.courses, next.courses);
  const sectionDiff = diffById(prev.classSections, next.classSections);
  const scheduleDiff = diffById(prev.schedules, next.schedules);
  const lessonDiff = diffById(prev.lessons, next.lessons);
  const resourceDiff = diffById(prev.libraryResources, next.libraryResources);
  const presentationDiff = diffById(
    prev.classPresentationSettings.map((s) => ({ ...s, id: s.classSectionId })),
    next.classPresentationSettings.map((s) => ({ ...s, id: s.classSectionId })),
  );
  const assignmentDiff = diffById(prev.teacherPeriodAssignments, next.teacherPeriodAssignments);
  // Independent of every other diff here by construction: transition_overrides
  // has no FK to lessons, bell_schedules, schedule_blocks,
  // schedule_block_overrides, or teacher_period_assignments (see that
  // table's own migration comment) - so this diff/write can never be
  // coupled to, or triggered by, any of those tables' changes.
  const transitionOverrideDiff = diffById(prev.transitionOverrides, next.transitionOverrides);

  // Per-schedule nested block/override diffs, computed against whichever
  // schedule (by id) existed in prev - a schedule present in both counts
  // its blocks/overrides even if the schedule's own top-level fields
  // (name/isDefault/etc.) didn't change.
  const prevSchedulesById = new Map(prev.schedules.map((s) => [s.id, s]));
  const blockDiffsBySchedule = new Map<string, ReturnType<typeof diffById<BellSchedule["blocks"][number]>>>();
  // Keyed by the CLOUD (schedule-scoped) block id, not the raw local
  // block.id - a local block id is only unique within its own schedule
  // (see Map_.scheduleBlockCloudId's doc comment), so keying this map on
  // the raw local id could silently conflate two different schedules'
  // blocks that happen to share one, overwriting one's override diff with
  // the other's.
  const overrideDiffsByCloudBlockId = new Map<
    string,
    ReturnType<typeof diffById<BellSchedule["blocks"][number]["overrides"][number]>>
  >();
  for (const schedule of next.schedules) {
    // Stage E hard requirement: an organization-owned schedule's blocks are
    // never teacher-writable - schedule_blocks/schedule_block_overrides
    // belong to the org admin. A block's `classSectionId` on such a
    // schedule is a per-teacher MERGED VIEW derived from
    // teacherPeriodAssignments (see rowsToBellSchedule), recomputed at
    // every load() and kept in sync locally by setTeacherPeriodAssignment -
    // never a real schedule_blocks column value for this teacher, so it
    // must never be diffed/upserted here. Skipping the whole schedule here
    // is what keeps an assignment change from ever producing a
    // bell_schedules/schedule_blocks/schedule_block_overrides write.
    if (schedule.ownerType === "organization") continue;
    const priorSchedule = prevSchedulesById.get(schedule.id);
    const priorBlocks = priorSchedule?.blocks ?? [];
    blockDiffsBySchedule.set(schedule.id, diffById(priorBlocks, schedule.blocks));
    const priorBlocksById = new Map(priorBlocks.map((b) => [b.id, b]));
    for (const block of schedule.blocks) {
      const priorOverrides = priorBlocksById.get(block.id)?.overrides ?? [];
      overrideDiffsByCloudBlockId.set(
        Map_.scheduleBlockCloudId(schedule.id, block.id),
        diffById(priorOverrides, block.overrides),
      );
    }
  }
  // Schedules removed entirely still need their blocks/overrides deleted -
  // CASCADE handles this at the DB level (schedule_blocks/overrides ->
  // bell_schedules is ON DELETE CASCADE), so no explicit child-delete is
  // needed for a fully-removed schedule.

  // Library resource <-> course link diffs, per resource, against prev's
  // last-known courseIds (prev is authoritative for "what's in the DB now"
  // - see module docs).
  const prevResourcesById = new Map(prev.libraryResources.map((r) => [r.id, r]));

  // Lesson <-> section derived row: today's shape is exactly one
  // lesson_class_sections row per lesson, keyed by the lesson's own id.
  const sectionResolvableCourseId = (lesson: DailyLesson): string => {
    const section = next.classSections.find((s) => s.id === lesson.classSectionId);
    if (!section) {
      throw new Error(
        `Lesson ${lesson.id} references classSectionId ${lesson.classSectionId}, which has no matching class section - refusing to guess a course_id.`,
      );
    }
    return section.courseId;
  };

  // ---- Delete pass (child-before-parent) ----
  // teacher_period_assignments is a leaf table (nothing references it) -
  // deleted early alongside the other leaf tables below. Deleting a row
  // here whose class_section_id or schedule_block_id was ALSO deleted this
  // same save (via their own ON DELETE CASCADE) simply deletes 0 rows -
  // harmless either way, so no ordering dependency on those deletes exists.
  for (const id of assignmentDiff.removedIds) {
    unwrap(await client.from("teacher_period_assignments").delete().eq("id", id), "delete teacher_period_assignments");
  }
  // Also a leaf table, also deleted early alongside teacher_period_assignments
  // - nothing references transition_overrides, so ordering relative to
  // every other delete/upsert below is irrelevant.
  for (const id of transitionOverrideDiff.removedIds) {
    unwrap(await client.from("transition_overrides").delete().eq("id", id), "delete transition_overrides");
  }
  for (const id of presentationDiff.removedIds) {
    unwrap(await client.from("class_presentation_settings").delete().eq("class_section_id", id), "delete class_presentation_settings");
  }
  for (const id of resourceDiff.removedIds) {
    unwrap(await client.from("library_resource_courses").delete().eq("library_resource_id", id), "delete library_resource_courses");
    unwrap(await client.from("library_resources").delete().eq("id", id), "delete library_resources");
  }
  // Resources kept but with changed courseIds: reconcile links.
  for (const resource of [...resourceDiff.added, ...resourceDiff.updated]) {
    const priorCourseIds = new Set(prevResourcesById.get(resource.id)?.courseIds ?? []);
    const nextCourseIds = new Set(resource.courseIds);
    for (const courseId of priorCourseIds) {
      if (!nextCourseIds.has(courseId)) {
        unwrap(
          await client
            .from("library_resource_courses")
            .delete()
            .eq("library_resource_id", resource.id)
            .eq("course_id", courseId),
          "delete library_resource_courses",
        );
      }
    }
  }
  for (const id of lessonDiff.removedIds) {
    unwrap(await client.from("lesson_class_sections").delete().eq("lesson_id", id), "delete lesson_class_sections");
    unwrap(await client.from("lessons").delete().eq("id", id), "delete lessons");
  }
  for (const [cloudBlockId, diff] of overrideDiffsByCloudBlockId) {
    for (const id of diff.removedIds) {
      unwrap(
        await client
          .from("schedule_block_overrides")
          .delete()
          .eq("id", Map_.scheduleBlockOverrideCloudId(cloudBlockId, id))
          .eq("schedule_block_id", cloudBlockId),
        "delete schedule_block_overrides",
      );
    }
  }
  for (const [scheduleId, diff] of blockDiffsBySchedule) {
    for (const id of diff.removedIds) {
      unwrap(
        await client.from("schedule_blocks").delete().eq("id", Map_.scheduleBlockCloudId(scheduleId, id)),
        "delete schedule_blocks",
      );
    }
  }
  for (const id of scheduleDiff.removedIds) {
    unwrap(await client.from("bell_schedules").delete().eq("id", id), "delete bell_schedules");
  }
  for (const id of sectionDiff.removedIds) {
    unwrap(await client.from("class_sections").delete().eq("id", id), "delete class_sections");
  }
  for (const id of courseDiff.removedIds) {
    unwrap(await client.from("courses").delete().eq("id", id), "delete courses");
  }

  // ---- Upsert pass (parent-before-child) ----
  const coursesToWrite = [...courseDiff.added, ...courseDiff.updated];
  if (coursesToWrite.length > 0) {
    unwrap(
      await client.from("courses").upsert(coursesToWrite.map((c) => Map_.courseToRow(c, ctx))),
      "upsert courses",
    );
  }

  const sectionsToWrite = [...sectionDiff.added, ...sectionDiff.updated];
  if (sectionsToWrite.length > 0) {
    unwrap(
      await client.from("class_sections").upsert(sectionsToWrite.map((s) => Map_.classSectionToRow(s, ctx))),
      "upsert class_sections",
    );
  }

  // Stage E hard requirement (see the block/override diff loop above for
  // the full reasoning): an organization-owned schedule is never written
  // to bell_schedules by a teacher's own save - it can only ever appear
  // here as "updated" because its blocks' merged classSectionId view
  // changed locally, never a real change to the schedule's own row.
  const schedulesToWrite = [...scheduleDiff.added, ...scheduleDiff.updated].filter(
    (schedule) => schedule.ownerType !== "organization",
  );
  if (schedulesToWrite.length > 0) {
    unwrap(
      await client.from("bell_schedules").upsert(schedulesToWrite.map((s) => Map_.bellScheduleToRow(s, ctx))),
      "upsert bell_schedules",
    );
  }

  for (const schedule of next.schedules) {
    const diff = blockDiffsBySchedule.get(schedule.id);
    if (!diff) continue;
    const blocksToWrite = [...diff.added, ...diff.updated];
    if (blocksToWrite.length > 0) {
      const position = new Map(schedule.blocks.map((b, index) => [b.id, index]));
      unwrap(
        await client
          .from("schedule_blocks")
          .upsert(blocksToWrite.map((b) => Map_.scheduleBlockToRow(b, position.get(b.id) ?? 0, schedule.id, ctx))),
        "upsert schedule_blocks",
      );
    }
    for (const block of schedule.blocks) {
      const cloudBlockId = Map_.scheduleBlockCloudId(schedule.id, block.id);
      const overrideDiff = overrideDiffsByCloudBlockId.get(cloudBlockId);
      if (!overrideDiff) continue;
      const overridesToWrite = [...overrideDiff.added, ...overrideDiff.updated];
      if (overridesToWrite.length > 0) {
        unwrap(
          await client
            .from("schedule_block_overrides")
            .upsert(overridesToWrite.map((o) => Map_.scheduleBlockOverrideToRow(o, cloudBlockId, ctx))),
          "upsert schedule_block_overrides",
        );
      }
    }
  }

  // Stage E: base (and any pre-existing, untouched weekday-specific)
  // teacher_period_assignments rows. class_sections/schedule_blocks this
  // references are upserted above (in the same pass) whenever they're also
  // new in this same save.
  const assignmentsToWrite = [...assignmentDiff.added, ...assignmentDiff.updated];
  if (assignmentsToWrite.length > 0) {
    unwrap(
      await client
        .from("teacher_period_assignments")
        .upsert(assignmentsToWrite.map((a) => Map_.teacherPeriodAssignmentToRow(a, ctx))),
      "upsert teacher_period_assignments",
    );
  }

  // Independent write, same reasoning as the diff above: never coupled to
  // lessons, bell_schedules, schedule_blocks, schedule_block_overrides, or
  // teacher_period_assignments writes in this same save() call.
  const transitionOverridesToWrite = [...transitionOverrideDiff.added, ...transitionOverrideDiff.updated];
  if (transitionOverridesToWrite.length > 0) {
    unwrap(
      await client
        .from("transition_overrides")
        .upsert(transitionOverridesToWrite.map((o) => Map_.transitionOverrideToRow(o, ctx))),
      "upsert transition_overrides",
    );
  }

  // Calendar: single-row upsert only if it changed (deletion/creation of
  // the calendar itself is out of scope for save() - see migrateLocalData
  // for calendar creation, and RLS restricts writes here to admins).
  if (!Map_.deepEqual(prev.schoolCalendar, next.schoolCalendar) && next.schoolCalendar) {
    unwrap(
      await client.from("school_year_calendars").upsert(Map_.schoolYearCalendarToRow(next.schoolCalendar, ctx)),
      "upsert school_year_calendars",
    );
    const exceptionDiff = diffById(prev.schoolCalendar?.exceptions ?? [], next.schoolCalendar.exceptions);
    for (const id of exceptionDiff.removedIds) {
      unwrap(await client.from("school_calendar_exceptions").delete().eq("id", id), "delete school_calendar_exceptions");
    }
    const exceptionsToWrite = [...exceptionDiff.added, ...exceptionDiff.updated];
    if (exceptionsToWrite.length > 0) {
      unwrap(
        await client
          .from("school_calendar_exceptions")
          .upsert(exceptionsToWrite.map((e) => Map_.schoolCalendarExceptionToRow(e, next.schoolCalendar!.id, ctx))),
        "upsert school_calendar_exceptions",
      );
    }
  }

  const lessonsToWrite = [...lessonDiff.added, ...lessonDiff.updated];
  if (lessonsToWrite.length > 0) {
    unwrap(
      await client
        .from("lessons")
        .upsert(lessonsToWrite.map((lesson) => Map_.lessonToRow(lesson, sectionResolvableCourseId(lesson), ctx))),
      "upsert lessons",
    );
    unwrap(
      await client
        .from("lesson_class_sections")
        .upsert(lessonsToWrite.map((lesson) => Map_.lessonClassSectionToRow(lesson, ctx))),
      "upsert lesson_class_sections",
    );
  }
  // A lesson whose date/classSectionId changed but wasn't otherwise "added"
  // still needs its join row's denormalized lesson_date/class_section_id
  // refreshed - upsert covers this since lesson.id is the join's own
  // conflict target only when we always re-derive it from the current
  // lesson object above (lessonsToWrite already includes any `updated`
  // lesson, which recomputes lessonClassSectionToRow from the latest data).

  const resourcesToWrite = [...resourceDiff.added, ...resourceDiff.updated];
  if (resourcesToWrite.length > 0) {
    unwrap(
      await client.from("library_resources").upsert(resourcesToWrite.map((r) => Map_.libraryResourceToRow(r, ctx))),
      "upsert library_resources",
    );
  }
  for (const resource of resourcesToWrite) {
    const priorCourseIds = new Set(prevResourcesById.get(resource.id)?.courseIds ?? []);
    const newLinks = resource.courseIds.filter((courseId) => !priorCourseIds.has(courseId));
    if (newLinks.length > 0) {
      unwrap(
        await client
          .from("library_resource_courses")
          .upsert(newLinks.map((courseId) => Map_.libraryResourceCourseToRow(resource.id, courseId, ctx))),
        "upsert library_resource_courses",
      );
    }
  }

  const presentationToWrite = [...presentationDiff.added, ...presentationDiff.updated];
  if (presentationToWrite.length > 0) {
    unwrap(
      await client
        .from("class_presentation_settings")
        .upsert(presentationToWrite.map((s) => Map_.classPresentationSettingsToRow(s, ctx))),
      "upsert class_presentation_settings",
    );
  }

  // The two one-row-per-teacher tables are written as "only the columns
  // this tab changed", never as the whole row - see changedColumns().
  const experiencePatch = changedColumns(
    Map_.classroomExperienceSettingsToRow(prev.classroomExperienceSettings, ctx),
    Map_.classroomExperienceSettingsToRow(next.classroomExperienceSettings, ctx),
  );
  if (experiencePatch) {
    const updated = unwrap(
      await client
        .from("classroom_experience_settings")
        .update(experiencePatch)
        .eq("owner_membership_id", ctx.membershipId)
        .select("owner_membership_id"),
      "update classroom_experience_settings",
    );
    if (updated.length === 0) {
      unwrap(
        await client
          .from("classroom_experience_settings")
          .upsert(Map_.classroomExperienceSettingsToRow(next.classroomExperienceSettings, ctx)),
        "upsert classroom_experience_settings",
      );
    }
  }

  const preferencesPatch = changedColumns(
    Map_.teacherSchedulePreferencesToRow(prev.teacherSchedulePreferences, ctx),
    Map_.teacherSchedulePreferencesToRow(next.teacherSchedulePreferences, ctx),
  );
  if (preferencesPatch) {
    const updated = unwrap(
      await client
        .from("teacher_schedule_preferences")
        .update(preferencesPatch)
        .eq("owner_membership_id", ctx.membershipId)
        .select("owner_membership_id"),
      "update teacher_schedule_preferences",
    );
    if (updated.length === 0) {
      unwrap(
        await client
          .from("teacher_schedule_preferences")
          .upsert(Map_.teacherSchedulePreferencesToRow(next.teacherSchedulePreferences, ctx)),
        "upsert teacher_schedule_preferences",
      );
    }
  }
}

/**
 * The columns whose value differs between `prev` and `next`, or `null` when
 * none do.
 *
 * Why the one-row-per-teacher tables are patched rather than upserted
 * whole: `prev` and `next` are both THIS TAB's view. A column this tab did
 * not change may hold a newer value in the database - written by another
 * tab, another device, or a server-side function - that this tab
 * has never seen. Sending the whole row would silently put this tab's old
 * value back (e.g. a tab that only changes the lunch wave clearing the
 * active schedule another tab just set). Sending only what changed means a
 * tab can only ever overwrite what its own user actually edited.
 *
 * If no row exists yet the UPDATE matches nothing, and the caller falls
 * back to inserting the whole row - there is nothing newer to protect.
 */
function changedColumns<Row extends object>(prev: Row, next: Row): Partial<Row> | null {
  const patch: Partial<Row> = {};
  let changed = false;
  for (const column of Object.keys(next) as Array<keyof Row>) {
    if (!Map_.deepEqual(prev[column], next[column])) {
      patch[column] = next[column];
      changed = true;
    }
  }
  return changed ? patch : null;
}

// ---------------------------------------------------------------------------
// Recovering from a failed save
// ---------------------------------------------------------------------------

/**
 * What a failed save may or may not have written. applyDiff() is a
 * sequence of independent writes, so when it throws partway nobody knows
 * which of the rows it meant to change actually changed. Those rows - and
 * only those - are "uncertain" until a later save succeeds.
 */
export interface UncertainWrites {
  courses: Set<string>;
  classSections: Set<string>;
  schedules: Set<string>;
  lessons: Set<string>;
  libraryResources: Set<string>;
  classPresentationSettings: Set<string>;
  teacherPeriodAssignments: Set<string>;
  transitionOverrides: Set<string>;
  schoolCalendar: boolean;
  /** Field names (not ids) of the two one-row-per-teacher settings objects. */
  teacherSchedulePreferences: Set<string>;
  classroomExperienceSettings: Set<string>;
}

export function noUncertainWrites(): UncertainWrites {
  return {
    courses: new Set(),
    classSections: new Set(),
    schedules: new Set(),
    lessons: new Set(),
    libraryResources: new Set(),
    classPresentationSettings: new Set(),
    teacherPeriodAssignments: new Set(),
    transitionOverrides: new Set(),
    schoolCalendar: false,
    teacherSchedulePreferences: new Set(),
    classroomExperienceSettings: new Set(),
  };
}

const presentationKey = (settings: AppData["classPresentationSettings"][number]) => settings.classSectionId;
const idKey = (item: Keyed) => item.id;

function addChangedKeys<T>(into: Set<string>, prev: T[], next: T[], keyOf: (item: T) => string): void {
  const prevByKey = new Map(prev.map((item) => [keyOf(item), item]));
  const nextKeys = new Set(next.map(keyOf));
  for (const item of next) {
    const prior = prevByKey.get(keyOf(item));
    if (!prior || !Map_.deepEqual(prior, item)) into.add(keyOf(item));
  }
  for (const key of prevByKey.keys()) {
    if (!nextKeys.has(key)) into.add(key);
  }
}

/** Records every row a save from `prev` to `next` would have touched. Accumulates across consecutive failures. */
export function recordAttemptedWrites(into: UncertainWrites, prev: AppData, next: AppData): void {
  addChangedKeys(into.courses, prev.courses, next.courses, idKey);
  addChangedKeys(into.classSections, prev.classSections, next.classSections, idKey);
  addChangedKeys(into.schedules, prev.schedules, next.schedules, idKey);
  addChangedKeys(into.lessons, prev.lessons, next.lessons, idKey);
  addChangedKeys(into.libraryResources, prev.libraryResources, next.libraryResources, idKey);
  addChangedKeys(into.classPresentationSettings, prev.classPresentationSettings, next.classPresentationSettings, presentationKey);
  addChangedKeys(into.teacherPeriodAssignments, prev.teacherPeriodAssignments, next.teacherPeriodAssignments, idKey);
  addChangedKeys(into.transitionOverrides, prev.transitionOverrides, next.transitionOverrides, idKey);
  if (!Map_.deepEqual(prev.schoolCalendar, next.schoolCalendar)) into.schoolCalendar = true;
  addChangedFields(into.teacherSchedulePreferences, prev.teacherSchedulePreferences, next.teacherSchedulePreferences);
  addChangedFields(into.classroomExperienceSettings, prev.classroomExperienceSettings, next.classroomExperienceSettings);
}

function addChangedFields<T extends object>(into: Set<string>, prev: T, next: T): void {
  for (const field of new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof T & string>) {
    if (!Map_.deepEqual(prev[field], next[field])) into.add(field);
  }
}

/** `baseline`, with just the uncertain fields replaced by what the database now holds for them. */
function rebaseFields<T extends object>(baseline: T, remote: T, uncertain: Set<string>): T {
  if (uncertain.size === 0) return baseline;
  const rebased = { ...baseline };
  for (const field of uncertain as Set<keyof T & string>) rebased[field] = remote[field];
  return rebased;
}

function rebaseList<T>(baseline: T[], remote: T[], uncertain: Set<string>, keyOf: (item: T) => string): T[] {
  if (uncertain.size === 0) return baseline;
  return [
    ...baseline.filter((item) => !uncertain.has(keyOf(item))),
    ...remote.filter((item) => uncertain.has(keyOf(item))),
  ];
}

/**
 * The baseline to diff the next save against after a failure.
 *
 * `baseline` is the last state this tab KNOWS the database held for its own
 * rows. `remote` is the database as just re-read. For each uncertain row
 * the truth is taken from `remote` (present with whatever it now holds, or
 * absent), so the next save corrects exactly what the failed one left
 * behind. Every other row keeps its `baseline` value.
 *
 * What this deliberately does NOT do is adopt `remote` wholesale. `remote`
 * may contain rows this tab has never loaded - created by another tab,
 * another device, or a server-side function. Diffed against this tab's memory
 * they would all look "removed" and be deleted. A row that is neither in
 * `baseline` nor uncertain is therefore left out entirely: this tab did not
 * create it, has not seen it, and has no business touching it.
 *
 * The two one-row-per-teacher settings follow the same rule one level
 * down, per field: a field the failed save tried to change is re-read; a
 * field this tab never changed keeps its `baseline` value, so the
 * changed-columns-only write (see changedColumns) still cannot touch it.
 */
export function rebaseline(baseline: AppData, remote: AppData, uncertain: UncertainWrites): AppData {
  return {
    ...baseline,
    courses: rebaseList(baseline.courses, remote.courses, uncertain.courses, idKey),
    classSections: rebaseList(baseline.classSections, remote.classSections, uncertain.classSections, idKey),
    schedules: rebaseList(baseline.schedules, remote.schedules, uncertain.schedules, idKey),
    lessons: rebaseList(baseline.lessons, remote.lessons, uncertain.lessons, idKey),
    libraryResources: rebaseList(baseline.libraryResources, remote.libraryResources, uncertain.libraryResources, idKey),
    classPresentationSettings: rebaseList(
      baseline.classPresentationSettings,
      remote.classPresentationSettings,
      uncertain.classPresentationSettings,
      presentationKey,
    ),
    teacherPeriodAssignments: rebaseList(
      baseline.teacherPeriodAssignments,
      remote.teacherPeriodAssignments,
      uncertain.teacherPeriodAssignments,
      idKey,
    ),
    transitionOverrides: rebaseList(baseline.transitionOverrides, remote.transitionOverrides, uncertain.transitionOverrides, idKey),
    teacherSchedulePreferences: rebaseFields(
      baseline.teacherSchedulePreferences,
      remote.teacherSchedulePreferences,
      uncertain.teacherSchedulePreferences,
    ),
    classroomExperienceSettings: rebaseFields(
      baseline.classroomExperienceSettings,
      remote.classroomExperienceSettings,
      uncertain.classroomExperienceSettings,
    ),
    // Same rule for the one calendar: take the re-read value only when it
    // is the same calendar this tab already knew, never a different one.
    schoolCalendar:
      uncertain.schoolCalendar && remote.schoolCalendar !== null && remote.schoolCalendar.id === baseline.schoolCalendar?.id
        ? remote.schoolCalendar
        : baseline.schoolCalendar,
  };
}

// ---------------------------------------------------------------------------
// The repository itself
// ---------------------------------------------------------------------------

/**
 * DataRepository implementation backed by Supabase. Constructed with the
 * already-authenticated client and the caller's resolved organization/
 * membership context (see lib/auth/dal.ts's resolveActiveOrganization) -
 * this class never authenticates, never resolves organization context
 * itself, and never imports anything UI-facing. RLS is the real
 * authorization boundary; the organization_id/owner_membership_id filters
 * here are defense-in-depth, matching the pattern used throughout
 * lib/auth/dal.ts.
 */
export class SupabaseDataRepository implements DataRepository {
  private readonly client: Client;
  private readonly ctx: OwnerContext;
  /**
   * What this tab knows the database holds for the rows it has loaded or
   * written - set by load(), advanced only by a fully successful save, and
   * never discarded on failure (see runCriticalSection).
   */
  private lastSnapshot: AppData | null = null;
  /** Rows one or more failed saves may have half-written; null when the last save succeeded. */
  private uncertain: UncertainWrites | null = null;

  /**
   * At most one critical section (read baseline -> applyDiff -> advance
   * baseline) runs at a time. `pending` holds the single latest AppData
   * snapshot - plus every caller currently waiting on it - that arrived
   * while a critical section was already running: a new arrival simply
   * replaces `pending.data` and appends its own resolver, so any number of
   * overlapping save() calls collapse into at most one further write, not
   * one per call. This is only safe because each save(data) carries a
   * COMPLETE AppData snapshot and, within one tab's single reducer, a
   * later snapshot is always a superset/evolution of an earlier one - the
   * intermediate ones being discarded unwritten is lossless.
   */
  private inFlight = false;
  private pending: { data: AppData; waiters: Array<(result: SaveResult) => void> } | null = null;

  constructor(client: Client, ctx: OwnerContext) {
    this.client = client;
    this.ctx = ctx;
  }

  async load(): Promise<AppData> {
    const data = await fetchAppData(this.client, this.ctx);
    this.lastSnapshot = structuredClone(data);
    this.uncertain = null;
    return data;
  }

  async save(data: AppData): Promise<SaveResult> {
    if (!this.inFlight) {
      return this.runCriticalSection(data);
    }
    return new Promise<SaveResult>((resolve) => {
      this.pending = { data, waiters: [...(this.pending?.waiters ?? []), resolve] };
    });
  }

  private async runCriticalSection(data: AppData): Promise<SaveResult> {
    this.inFlight = true;
    // The baseline this attempt is diffed against - kept outside the try so
    // a failure can record exactly which rows the attempt would have
    // touched.
    let prev: AppData | null = null;
    try {
      // A save before any load() has no baseline of its own: the database
      // as it stands is the only honest starting point.
      this.lastSnapshot ??= await fetchAppData(this.client, this.ctx);

      // After a failed save, the rows that attempt may have half-written
      // are re-read so this attempt corrects them from the truth. Only
      // those rows: see rebaseline() for why the re-read state is never
      // adopted wholesale.
      prev = this.uncertain
        ? rebaseline(this.lastSnapshot, await fetchAppData(this.client, this.ctx), this.uncertain)
        : this.lastSnapshot;

      await applyDiff(this.client, this.ctx, prev, data);

      // Only advance the snapshot after every write above succeeded -
      // Decision 2's core requirement.
      this.lastSnapshot = structuredClone(data);
      this.uncertain = null;

      return { ok: true };
    } catch (error) {
      // applyDiff is not atomic - it issues a sequence of independent
      // upserts/deletes, so a failure partway through may have already
      // written part of this attempt to the database. The baseline is KEPT
      // (it is still what this tab last knew), and the rows this attempt
      // set out to change are marked uncertain, so the next critical
      // section re-reads real cloud state for exactly those rows.
      //
      // The baseline used to be discarded here and replaced by a full
      // re-read. That re-read includes rows this tab never loaded; diffed
      // against this tab's memory they looked removed and were deleted -
      // see scripts/verify-stale-tab-save-safety.ts.
      //
      // `data` is not consumed by a failure: AppDataProvider still holds
      // it and passes it (or its successor) to the next save(), so the
      // teacher's unsaved edits are retried, never dropped.
      if (prev) {
        this.uncertain ??= noUncertainWrites();
        recordAttemptedWrites(this.uncertain, prev, data);
      }
      return {
        ok: false,
        reason: "unknown",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error saving to Supabase.",
      };
    } finally {
      this.inFlight = false;
      const promoted = this.pending;
      this.pending = null;
      if (promoted) {
        void this.runCriticalSection(promoted.data).then((result) => {
          for (const resolve of promoted.waiters) resolve(result);
        });
      }
    }
  }

  /**
   * No cross-device realtime/data-change detection in this milestone - see
   * docs/V2_ARCHITECTURE.md §12.7 (locked: not required for V2). This only
   * ever reports "session-ended", narrowly on Supabase's own SIGNED_OUT
   * event - never Postgres Realtime, never polling.
   *
   * The callback passed to `onAuthStateChange` does no async/Supabase work
   * itself - per current Supabase guidance, calling other `supabase.auth.*`
   * methods (or anything that could trigger another auth state change)
   * synchronously inside this callback risks deadlocking GoTrueClient's
   * internal lock. `repository.load()` (which AppDataProvider runs in
   * response to `onEvent`) is never called here directly - only a plain,
   * non-Supabase notification, and even that is deferred via `setTimeout`
   * so it runs strictly after this callback's own synchronous execution
   * finishes, not inside it.
   */
  subscribeToExternalChanges(onEvent: (event: ExternalChangeEvent) => void): () => void {
    const {
      data: { subscription },
    } = this.client.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      setTimeout(() => onEvent("session-ended"), 0);
    });
    return () => subscription.unsubscribe();
  }
}
