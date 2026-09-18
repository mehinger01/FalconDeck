import type { Database } from "./supabase.types";
import type { AppData } from "./types";
import type { ClassSection, Course } from "@/types/course";
import type { BellSchedule, ScheduleBlock, ScheduleBlockOverride } from "@/types/schedule";
import type { AgendaItem, Announcement, DailyLesson, LessonResource } from "@/types/lesson";
import type { LibraryResource, LibraryResourceSource } from "@/types/resource";
import type { ClassPresentationSettings, ClassroomExperienceSettings } from "@/types/classPresentation";
import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";
import type { SchoolCalendarException, SchoolYearCalendar } from "@/types/calendar";

/**
 * Everything a row needs to know about "whose data is this" - denormalized
 * onto every row per the schema's own convention (V2_DATABASE_SCHEMA.md
 * §0.2). Every "to row" function in this file takes this, never anything
 * wider (no service-role context, no other user's ids).
 */
export interface OwnerContext {
  organizationId: string;
  membershipId: string;
}

export type CoursesRow = Database["public"]["Tables"]["courses"]["Row"];
export type ClassSectionsRow = Database["public"]["Tables"]["class_sections"]["Row"];
export type BellSchedulesRow = Database["public"]["Tables"]["bell_schedules"]["Row"];
export type ScheduleBlocksRow = Database["public"]["Tables"]["schedule_blocks"]["Row"];
export type ScheduleBlockOverridesRow = Database["public"]["Tables"]["schedule_block_overrides"]["Row"];
export type SchoolYearCalendarsRow = Database["public"]["Tables"]["school_year_calendars"]["Row"];
export type SchoolCalendarExceptionsRow = Database["public"]["Tables"]["school_calendar_exceptions"]["Row"];
export type LessonsRow = Database["public"]["Tables"]["lessons"]["Row"];
export type LessonClassSectionsRow = Database["public"]["Tables"]["lesson_class_sections"]["Row"];
export type LibraryResourcesRow = Database["public"]["Tables"]["library_resources"]["Row"];
export type LibraryResourceCoursesRow = Database["public"]["Tables"]["library_resource_courses"]["Row"];
export type ClassPresentationSettingsRow = Database["public"]["Tables"]["class_presentation_settings"]["Row"];
export type ClassroomExperienceSettingsRow = Database["public"]["Tables"]["classroom_experience_settings"]["Row"];
export type TeacherSchedulePreferencesRow = Database["public"]["Tables"]["teacher_schedule_preferences"]["Row"];

// "Insert" variants - used only by the *ToRow() functions below that have no
// real local created_at/updated_at source. Deliberately narrower than the
// generated `Insert` type: `Omit<Row, "created_at" | "updated_at">` relaxes
// *only* those two columns (matching the database's `DEFAULT now()` - the
// fix for the bug this type distinction exists to prevent, writing
// `created_at: ""` into a timestamptz column instead of omitting the field)
// while keeping every other field exactly as strict as the real Row shape.
// The generated `Insert` type is not used here on purpose - it independently
// widens every nullable/defaulted column to also allow `undefined`, which
// would silently relax fields these functions never actually omit.
export type CoursesInsert = Omit<CoursesRow, "created_at" | "updated_at">;
export type ClassSectionsInsert = Omit<ClassSectionsRow, "created_at" | "updated_at">;
export type BellSchedulesInsert = Omit<BellSchedulesRow, "created_at" | "updated_at">;
export type ScheduleBlocksInsert = Omit<ScheduleBlocksRow, "created_at" | "updated_at">;
export type ScheduleBlockOverridesInsert = Omit<ScheduleBlockOverridesRow, "created_at" | "updated_at">;
export type SchoolYearCalendarsInsert = Omit<SchoolYearCalendarsRow, "created_at" | "updated_at">;
export type SchoolCalendarExceptionsInsert = Omit<SchoolCalendarExceptionsRow, "created_at" | "updated_at">;
export type LessonClassSectionsInsert = Omit<LessonClassSectionsRow, "created_at" | "updated_at">;
export type LibraryResourceCoursesInsert = Omit<LibraryResourceCoursesRow, "created_at" | "updated_at">;
export type ClassPresentationSettingsInsert = Omit<ClassPresentationSettingsRow, "created_at" | "updated_at">;
export type ClassroomExperienceSettingsInsert = Omit<ClassroomExperienceSettingsRow, "created_at" | "updated_at">;
export type TeacherSchedulePreferencesInsert = Omit<TeacherSchedulePreferencesRow, "created_at" | "updated_at">;

// ---------------------------------------------------------------------------
// Local -> Supabase (write direction). Every function is pure - no I/O.
// ---------------------------------------------------------------------------

export function courseToRow(course: Course, ctx: OwnerContext): CoursesInsert {
  return {
    id: course.id,
    organization_id: ctx.organizationId,
    owner_type: "teacher",
    owner_membership_id: ctx.membershipId,
    name: course.name,
    color_hex: course.colorHex ?? null,
    description: course.description ?? null,
  };
}

export function classSectionToRow(section: ClassSection, ctx: OwnerContext): ClassSectionsInsert {
  return {
    id: section.id,
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
    course_id: section.courseId,
    name: section.name,
    room: section.room ?? null,
  };
}

/**
 * Always owner_type='teacher' - per the approved Decision 1, this migration
 * never creates or promotes organization-owned schedule data, regardless of
 * the local schedule's own `source` tag ("built-in" is descriptive metadata
 * here, not an ownership signal - see the SPECIAL CASE note in
 * lib/data/migration/migrateLocalData.ts).
 */
export function bellScheduleToRow(schedule: BellSchedule, ctx: OwnerContext): BellSchedulesInsert {
  return {
    id: schedule.id,
    organization_id: ctx.organizationId,
    owner_type: "teacher",
    owner_membership_id: ctx.membershipId,
    profile_key: null,
    name: schedule.name,
    description: schedule.description ?? null,
    time_zone: schedule.timeZone,
    is_default: schedule.isDefault,
    source: schedule.source ?? null,
    needs_configuration: schedule.needsConfiguration ?? false,
  };
}

export function scheduleBlockToRow(
  block: ScheduleBlock,
  position: number,
  bellScheduleId: string,
  ctx: OwnerContext,
): ScheduleBlocksInsert {
  return {
    id: block.id,
    bell_schedule_id: bellScheduleId,
    organization_id: ctx.organizationId,
    owner_type: "teacher",
    owner_membership_id: ctx.membershipId,
    position,
    label: block.label,
    kind: block.kind,
    custom_kind_label: block.customKindLabel ?? null,
    start_time: block.startTime,
    end_time: block.endTime,
    class_section_id: block.classSectionId ?? null,
    is_lunch_window: block.isLunchWindow ?? false,
  };
}

export function scheduleBlockOverrideToRow(
  override: ScheduleBlockOverride,
  scheduleBlockId: string,
  ctx: OwnerContext,
): ScheduleBlockOverridesInsert {
  return {
    id: override.id,
    schedule_block_id: scheduleBlockId,
    organization_id: ctx.organizationId,
    owner_type: "teacher",
    owner_membership_id: ctx.membershipId,
    weekday: override.weekday,
    label: override.label ?? null,
    kind: override.kind ?? null,
    custom_kind_label: override.customKindLabel ?? null,
    // Tri-state (undefined/null/string) -> boolean + nullable column, per
    // V2_DATABASE_SCHEMA.md §2.8.
    class_section_overridden: override.classSectionId !== undefined,
    class_section_id: override.classSectionId ?? null,
    start_time: override.startTime ?? null,
    end_time: override.endTime ?? null,
  };
}

/**
 * Always owner_type='teacher', owner_membership_id=ctx.membershipId,
 * is_canonical=false - per Decision 1 (Supabase Data Repository milestone)
 * and the corrective dual-ownership migration
 * (20260915000000_school_year_calendars_dual_ownership.sql). Migration
 * never creates or promotes canonical organization data; a teacher-owned
 * calendar is now a real, first-class row (not gated on role='admin' -
 * every teacher can migrate their own calendar).
 */
export function schoolYearCalendarToRow(calendar: SchoolYearCalendar, ctx: OwnerContext): SchoolYearCalendarsInsert {
  return {
    id: calendar.id,
    organization_id: ctx.organizationId,
    owner_type: "teacher",
    owner_membership_id: ctx.membershipId,
    name: calendar.name,
    school_year: calendar.schoolYear,
    time_zone: calendar.timeZone,
    first_student_day: calendar.firstStudentDay ?? null,
    last_student_day: calendar.lastStudentDay ?? null,
    is_canonical: false,
    default_bell_schedule_id: calendar.defaultBellScheduleId,
  };
}

export function schoolCalendarExceptionToRow(
  exception: SchoolCalendarException,
  schoolYearCalendarId: string,
  ctx: OwnerContext,
): SchoolCalendarExceptionsInsert {
  return {
    id: exception.id,
    school_year_calendar_id: schoolYearCalendarId,
    organization_id: ctx.organizationId,
    start_date: exception.startDate,
    end_date: exception.endDate,
    type: exception.type,
    title: exception.title,
    bell_schedule_id: exception.bellScheduleId ?? null,
    source_schedule_profile: exception.sourceScheduleProfile ?? null,
    dismissal_time: exception.dismissalTime ?? null,
    notes: exception.notes ?? null,
  };
}

/** `course_id` isn't stored on the local DailyLesson - the caller resolves it from the lesson's classSectionId via the local ClassSection[] list before calling this. */
export function lessonToRow(lesson: DailyLesson, courseId: string, ctx: OwnerContext): LessonsRow {
  return {
    id: lesson.id,
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
    course_id: courseId,
    lesson_date: lesson.date,
    learning_target: lesson.learningTarget,
    agenda_items: lesson.agendaItems as unknown as LessonsRow["agenda_items"],
    resources: lesson.resources as unknown as LessonsRow["resources"],
    announcements: lesson.announcements as unknown as LessonsRow["announcements"],
    materials: lesson.materials ?? null,
    created_at: lesson.createdAt,
    updated_at: lesson.updatedAt,
  };
}

export function lessonClassSectionToRow(lesson: DailyLesson, ctx: OwnerContext): LessonClassSectionsInsert {
  return {
    lesson_id: lesson.id,
    class_section_id: lesson.classSectionId,
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
    lesson_date: lesson.date,
  };
}

export function libraryResourceToRow(resource: LibraryResource, ctx: OwnerContext): LibraryResourcesRow {
  const source = resource.source;
  return {
    id: resource.id,
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
    title: resource.title,
    url: resource.url,
    type: resource.type,
    tags: resource.tags,
    notes: resource.notes ?? null,
    is_favorite: resource.isFavorite,
    source_kind: source.kind,
    source_drive_file_id: source.kind === "google-drive" ? source.driveFileId : null,
    source_mime_type: source.kind === "google-drive" ? (source.mimeType ?? null) : null,
    source_web_view_url: source.kind === "google-drive" ? (source.webViewUrl ?? null) : null,
    created_at: resource.createdAt,
    updated_at: resource.updatedAt,
  };
}

export function libraryResourceCourseToRow(
  libraryResourceId: string,
  courseId: string,
  ctx: OwnerContext,
): LibraryResourceCoursesInsert {
  return {
    library_resource_id: libraryResourceId,
    course_id: courseId,
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
  };
}

export function classPresentationSettingsToRow(
  settings: ClassPresentationSettings,
  ctx: OwnerContext,
): ClassPresentationSettingsInsert {
  return {
    class_section_id: settings.classSectionId,
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
    arrival_instructions: settings.arrivalInstructions,
  };
}

/**
 * `watermark_override_storage_path` is always written as `null` here -
 * uploading `customWatermarkDataUrl` to Supabase Storage is explicitly out
 * of scope for this phase (no Storage bucket/wiring exists yet). This is a
 * known, reported gap (see migration result `warnings`), not a silent drop:
 * the local data URL itself is untouched in localStorage, so nothing is
 * lost - it's simply not yet migrated.
 */
export function classroomExperienceSettingsToRow(
  settings: ClassroomExperienceSettings,
  ctx: OwnerContext,
): ClassroomExperienceSettingsInsert {
  return {
    owner_membership_id: ctx.membershipId,
    organization_id: ctx.organizationId,
    final_five_message: settings.finalFiveMessage,
    show_end_of_day_screen: settings.showEndOfDayScreen,
    end_of_day_message: settings.endOfDayMessage,
    clean_screen_default_message: settings.cleanScreenDefaultMessage,
    show_clock_on_clean_screen: settings.showClockOnCleanScreen,
    transition_countdown_enabled: settings.transitionCountdownEnabled,
    transition_arrival_instructions_enabled: settings.transitionArrivalInstructionsEnabled,
    watermark_override_storage_path: null,
    watermark_override_opacity: settings.watermarkOpacity,
    bell_offset_seconds: settings.bellOffsetSeconds,
  };
}

export function teacherSchedulePreferencesToRow(
  prefs: TeacherSchedulePreferences,
  ctx: OwnerContext,
): TeacherSchedulePreferencesInsert {
  return {
    owner_membership_id: ctx.membershipId,
    organization_id: ctx.organizationId,
    lunch_wave: prefs.lunchWave,
  };
}

// ---------------------------------------------------------------------------
// Supabase -> Local (read direction). Every function is pure - no I/O.
// ---------------------------------------------------------------------------

/**
 * Postgres `time` columns round-trip through PostgREST as "HH:MM:SS" or
 * "HH:MM:SS.ffffff", never Falcon Deck's canonical "HH:mm" - the value is
 * semantically identical, just formatted differently. This exists so
 * SupabaseDataRepository.load() reconstructs AppData using the exact same
 * string shape the app already produces locally, not a database-flavored
 * variant of it. Deliberately narrow: only collapses a seconds/fractional
 * component that is exactly zero. If seconds are ever meaningfully
 * non-zero, they are preserved (never silently discarded) rather than
 * forced into a lossy "HH:mm" shape local data has never actually needed
 * to represent. Unrecognized input is returned unchanged rather than
 * guessed at.
 */
export function normalizeDbTime(value: string): string {
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/);
  if (!match) return value;
  const [, hh, mm, ss, frac] = match;
  const secondsAreZero = (ss === undefined || ss === "00") && (frac === undefined || /^0+$/.test(frac));
  return secondsAreZero ? `${hh}:${mm}` : `${hh}:${mm}:${ss ?? "00"}`;
}

/**
 * Postgres `timestamptz` columns round-trip through PostgREST as e.g.
 * "2026-09-14T12:00:00+00:00" - a valid ISO 8601 instant, but not the exact
 * "...Z"-suffixed, millisecond-bearing shape `new Date().toISOString()`
 * (and every local AppData timestamp field) already uses. Re-parses and
 * re-serializes to that canonical shape - never a cosmetic rewrite of a
 * value AppData doesn't store (see the module docs: this is only applied
 * to fields that actually appear in AppData, e.g. DailyLesson.createdAt,
 * never a table's own created_at/updated_at bookkeeping columns).
 * Throws rather than fabricating a value if Postgres ever returns
 * something that doesn't parse as a valid instant - this value always
 * originates from the database, never from user input, so a parse failure
 * here means real data corruption worth surfacing loudly, consistent with
 * how migrateLocalData/applyDiff's `unwrap()` already throws on unexpected
 * database conditions elsewhere in this data layer.
 */
export function normalizeDbTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`normalizeDbTimestamp: "${value}" is not a valid timestamp`);
  }
  return date.toISOString();
}

export function rowToCourse(row: CoursesRow): Course {
  return { id: row.id, name: row.name, colorHex: row.color_hex ?? undefined, description: row.description ?? undefined };
}

export function rowToClassSection(row: ClassSectionsRow): ClassSection {
  return { id: row.id, courseId: row.course_id, name: row.name, room: row.room ?? undefined };
}

export function rowToScheduleBlockOverride(row: ScheduleBlockOverridesRow): ScheduleBlockOverride {
  return {
    id: row.id,
    weekday: row.weekday as ScheduleBlockOverride["weekday"],
    label: row.label ?? undefined,
    kind: (row.kind as ScheduleBlockOverride["kind"]) ?? undefined,
    customKindLabel: row.custom_kind_label ?? undefined,
    // Reverse of the tri-state mapping in scheduleBlockOverrideToRow.
    classSectionId: row.class_section_overridden ? row.class_section_id : undefined,
    startTime: row.start_time ? normalizeDbTime(row.start_time) : undefined,
    endTime: row.end_time ? normalizeDbTime(row.end_time) : undefined,
  };
}

/**
 * Assembles one BellSchedule from its own row plus its already-fetched
 * blocks/overrides. `assignedSectionByBlockId` supplies classSectionId for
 * ORG-owned blocks via teacher_period_assignments (a teacher-owned block
 * already carries it directly on the row) - see
 * lib/data/supabaseDataRepository.ts's load() for how that map is built.
 * No organization-owned schedule exists anywhere yet (Gap #1 from the
 * audit), so this path is implemented for correctness but not yet
 * exercised against real org data.
 */
export function rowsToBellSchedule(
  schedule: BellSchedulesRow,
  blocks: ScheduleBlocksRow[],
  overridesByBlockId: Map<string, ScheduleBlockOverridesRow[]>,
  assignedSectionByBlockId: Map<string, string | null>,
): BellSchedule {
  const sortedBlocks = [...blocks].sort((a, b) => a.position - b.position);
  return {
    id: schedule.id,
    name: schedule.name,
    description: schedule.description ?? undefined,
    isDefault: schedule.is_default,
    timeZone: schedule.time_zone,
    source: (schedule.source as BellSchedule["source"]) ?? undefined,
    needsConfiguration: schedule.needs_configuration,
    blocks: sortedBlocks.map((block) => {
      const classSectionId =
        schedule.owner_type === "organization"
          ? (assignedSectionByBlockId.get(block.id) ?? null)
          : block.class_section_id;
      return {
        id: block.id,
        label: block.label,
        kind: block.kind as ScheduleBlock["kind"],
        customKindLabel: block.custom_kind_label ?? undefined,
        startTime: normalizeDbTime(block.start_time),
        endTime: normalizeDbTime(block.end_time),
        classSectionId,
        isLunchWindow: block.is_lunch_window,
        overrides: (overridesByBlockId.get(block.id) ?? []).map(rowToScheduleBlockOverride),
      };
    }),
  };
}

export function rowsToSchoolYearCalendar(
  calendar: SchoolYearCalendarsRow,
  exceptions: SchoolCalendarExceptionsRow[],
): SchoolYearCalendar {
  return {
    id: calendar.id,
    name: calendar.name,
    schoolYear: calendar.school_year,
    timeZone: calendar.time_zone,
    firstStudentDay: calendar.first_student_day ?? "",
    lastStudentDay: calendar.last_student_day ?? "",
    defaultBellScheduleId: calendar.default_bell_schedule_id,
    exceptions: exceptions.map((exception) => ({
      id: exception.id,
      startDate: exception.start_date,
      endDate: exception.end_date,
      type: exception.type as SchoolCalendarException["type"],
      title: exception.title,
      bellScheduleId: exception.bell_schedule_id ?? undefined,
      sourceScheduleProfile: exception.source_schedule_profile ?? undefined,
      dismissalTime: exception.dismissal_time ?? undefined,
      notes: exception.notes ?? undefined,
    })),
  };
}

/** One DailyLesson per (lesson, section) pairing - see module docs in migrateLocalData.ts for why this is the correct reverse of today's one-section-per-lesson local shape even once reuse-across-sections is used. */
export function rowsToDailyLesson(lesson: LessonsRow, lessonClassSection: LessonClassSectionsRow): DailyLesson {
  return {
    id: lesson.id,
    date: lessonClassSection.lesson_date,
    classSectionId: lessonClassSection.class_section_id,
    learningTarget: lesson.learning_target,
    agendaItems: (lesson.agenda_items ?? []) as unknown as AgendaItem[],
    resources: (lesson.resources ?? []) as unknown as LessonResource[],
    announcements: (lesson.announcements ?? []) as unknown as Announcement[],
    materials: lesson.materials ?? undefined,
    createdAt: normalizeDbTimestamp(lesson.created_at),
    updatedAt: normalizeDbTimestamp(lesson.updated_at),
  };
}

export function rowsToLibraryResource(resource: LibraryResourcesRow, courseIds: string[]): LibraryResource {
  const source: LibraryResourceSource =
    resource.source_kind === "google-drive"
      ? {
          kind: "google-drive",
          driveFileId: resource.source_drive_file_id ?? "",
          mimeType: resource.source_mime_type ?? undefined,
          webViewUrl: resource.source_web_view_url ?? undefined,
        }
      : { kind: "manual" };
  return {
    id: resource.id,
    title: resource.title,
    url: resource.url,
    type: resource.type as LibraryResource["type"],
    courseIds,
    tags: resource.tags,
    notes: resource.notes ?? undefined,
    isFavorite: resource.is_favorite,
    source,
    createdAt: normalizeDbTimestamp(resource.created_at),
    updatedAt: normalizeDbTimestamp(resource.updated_at),
  };
}

export function rowToClassPresentationSettings(row: ClassPresentationSettingsRow): ClassPresentationSettings {
  return { classSectionId: row.class_section_id, arrivalInstructions: row.arrival_instructions };
}

/** `customWatermarkDataUrl` is always `undefined` here - see classroomExperienceSettingsToRow's doc comment; the Storage-backed watermark is a separate, not-yet-built migration step. */
export function rowToClassroomExperienceSettings(row: ClassroomExperienceSettingsRow | null): ClassroomExperienceSettings {
  if (!row) return DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS;
  return {
    finalFiveMessage: row.final_five_message,
    showEndOfDayScreen: row.show_end_of_day_screen,
    endOfDayMessage: row.end_of_day_message,
    cleanScreenDefaultMessage: row.clean_screen_default_message,
    showClockOnCleanScreen: row.show_clock_on_clean_screen,
    transitionCountdownEnabled: row.transition_countdown_enabled,
    transitionArrivalInstructionsEnabled: row.transition_arrival_instructions_enabled,
    customWatermarkDataUrl: undefined,
    watermarkOpacity: row.watermark_override_opacity ?? DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS.watermarkOpacity,
    bellOffsetSeconds: row.bell_offset_seconds,
  };
}

export function rowToTeacherSchedulePreferences(row: TeacherSchedulePreferencesRow | null): TeacherSchedulePreferences {
  if (!row) return DEFAULT_TEACHER_SCHEDULE_PREFERENCES;
  return { lunchWave: row.lunch_wave as TeacherSchedulePreferences["lunchWave"] };
}

/**
 * Recursive structural-equality helper the repository's save() diff and the
 * migration validator both use. Replaces a prior JSON.stringify-based
 * comparison, which broke on Postgres JSONB columns (lessons.agenda_items,
 * lessons.resources, lessons.announcements): JSONB does not preserve object
 * key insertion order on read, so a semantically-identical object could
 * come back with its keys in a different order and JSON.stringify would
 * report a false mismatch.
 *
 * - primitives compare with strict equality (no coercion); null only
 *   equals null (not undefined - `a === b` already enforces this)
 * - arrays: order and length matter; items compare recursively by index
 * - plain objects: key order does NOT matter, but the key *sets* must
 *   match - with one deliberate exception: a key whose value is
 *   `undefined` is treated as equivalent to that key being absent. This
 *   mirrors JSON.stringify's own long-standing behavior (which drops
 *   undefined-valued object properties) that this function replaces, and
 *   is required by an existing, pervasive convention in this file's
 *   reverse-mapping functions: every optional AppData field is returned as
 *   an explicit `field: undefined` (see rowToCourse, rowToClassSection,
 *   rowToScheduleBlockOverride, etc.) rather than the key being omitted,
 *   while hand-written/local AppData objects normally omit an unset
 *   optional key entirely. Without this exception, several already-correct
 *   round-trips (e.g. the schedule block override "inherit" tri-state
 *   case, optional course fields) would report false mismatches.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).filter((key) => aObj[key] !== undefined);
    const bKeys = Object.keys(bObj).filter((key) => bObj[key] !== undefined);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => bKeys.includes(key) && deepEqual(aObj[key], bObj[key]));
  }
  return false;
}

export type { AppData };
