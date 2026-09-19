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

  // Per-schedule nested block/override diffs, computed against whichever
  // schedule (by id) existed in prev - a schedule present in both counts
  // its blocks/overrides even if the schedule's own top-level fields
  // (name/isDefault/etc.) didn't change.
  const prevSchedulesById = new Map(prev.schedules.map((s) => [s.id, s]));
  const blockDiffsBySchedule = new Map<string, ReturnType<typeof diffById<BellSchedule["blocks"][number]>>>();
  const overrideDiffsByBlock = new Map<string, ReturnType<typeof diffById<BellSchedule["blocks"][number]["overrides"][number]>>>();
  for (const schedule of next.schedules) {
    const priorSchedule = prevSchedulesById.get(schedule.id);
    const priorBlocks = priorSchedule?.blocks ?? [];
    blockDiffsBySchedule.set(schedule.id, diffById(priorBlocks, schedule.blocks));
    const priorBlocksById = new Map(priorBlocks.map((b) => [b.id, b]));
    for (const block of schedule.blocks) {
      const priorOverrides = priorBlocksById.get(block.id)?.overrides ?? [];
      overrideDiffsByBlock.set(block.id, diffById(priorOverrides, block.overrides));
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
  for (const [blockId, diff] of overrideDiffsByBlock) {
    for (const id of diff.removedIds) {
      unwrap(
        await client.from("schedule_block_overrides").delete().eq("id", id).eq("schedule_block_id", blockId),
        "delete schedule_block_overrides",
      );
    }
  }
  for (const [, diff] of blockDiffsBySchedule) {
    for (const id of diff.removedIds) {
      unwrap(await client.from("schedule_blocks").delete().eq("id", id), "delete schedule_blocks");
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

  const schedulesToWrite = [...scheduleDiff.added, ...scheduleDiff.updated];
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
      const overrideDiff = overrideDiffsByBlock.get(block.id);
      if (!overrideDiff) continue;
      const overridesToWrite = [...overrideDiff.added, ...overrideDiff.updated];
      if (overridesToWrite.length > 0) {
        unwrap(
          await client
            .from("schedule_block_overrides")
            .upsert(overridesToWrite.map((o) => Map_.scheduleBlockOverrideToRow(o, block.id, ctx))),
          "upsert schedule_block_overrides",
        );
      }
    }
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

  if (!Map_.deepEqual(prev.classroomExperienceSettings, next.classroomExperienceSettings)) {
    unwrap(
      await client
        .from("classroom_experience_settings")
        .upsert(Map_.classroomExperienceSettingsToRow(next.classroomExperienceSettings, ctx)),
      "upsert classroom_experience_settings",
    );
  }

  if (!Map_.deepEqual(prev.teacherSchedulePreferences, next.teacherSchedulePreferences)) {
    unwrap(
      await client
        .from("teacher_schedule_preferences")
        .upsert(Map_.teacherSchedulePreferencesToRow(next.teacherSchedulePreferences, ctx)),
      "upsert teacher_schedule_preferences",
    );
  }
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
  private lastSnapshot: AppData | null = null;

  constructor(client: Client, ctx: OwnerContext) {
    this.client = client;
    this.ctx = ctx;
  }

  async load(): Promise<AppData> {
    const data = await fetchAppData(this.client, this.ctx);
    this.lastSnapshot = structuredClone(data);
    return data;
  }

  async save(data: AppData): Promise<SaveResult> {
    const prev = this.lastSnapshot ?? (await fetchAppData(this.client, this.ctx));
    try {
      await applyDiff(this.client, this.ctx, prev, data);
      // Only advance the snapshot after every write above succeeded -
      // Decision 2's core requirement.
      this.lastSnapshot = structuredClone(data);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: "unknown",
        message: error instanceof Error ? error.message : "Unknown error saving to Supabase.",
      };
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
