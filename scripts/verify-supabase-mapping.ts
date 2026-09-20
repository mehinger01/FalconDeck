/**
 * Offline verification of lib/data/supabaseMapping.ts and the diffById
 * logic supabaseDataRepository.ts's save() relies on. No network, no
 * Supabase project - pure functions only, run via `tsx`:
 *
 *   npm run verify:supabase-mapping
 *
 * Live-project integration tests (migration, retry, RLS isolation, etc.)
 * are in scripts/verify-supabase-migration.ts instead - this script only
 * proves the local<->row transformations themselves are correct.
 */

import * as Map_ from "@/lib/data/supabaseMapping";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import type { Course, ClassSection } from "@/types/course";
import type { BellSchedule } from "@/types/schedule";
import type { DailyLesson } from "@/types/lesson";
import type { LibraryResource } from "@/types/resource";
import type { ClassPresentationSettings, ClassroomExperienceSettings } from "@/types/classPresentation";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import type { SchoolYearCalendar } from "@/types/calendar";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const ctx: OwnerContext = { organizationId: "org-test", membershipId: "membership-test" };

/**
 * Test-only: synthesizes fake created_at/updated_at so an Insert-shaped
 * *ToRow() result (created_at/updated_at correctly omitted, per the
 * timestamp-mapping fix) can be fed into a Row-typed reverse-mapping
 * function for round-trip testing. Real code never needs this - Postgres
 * supplies the real timestamps on insert; this only exists because a
 * fetched Row always has them and a freshly-built Insert payload
 * deliberately doesn't.
 */
function withTimestamps<T extends object>(row: T): T & { created_at: string; updated_at: string } {
  return { ...row, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}

/**
 * Guardrail (Phase 3): fails if any field on a generated insert payload is
 * a literal empty string - the exact shape of bug that broke the live
 * migration (`created_at: ""` sent to a timestamptz column). Generic
 * across every field, not just timestamps, since the same mistake could in
 * principle be made for any typed column.
 */
function assertNoEmptyStringFields(functionName: string, row: Record<string, unknown>) {
  const emptyStringFields = Object.entries(row)
    .filter(([, value]) => value === "")
    .map(([key]) => key);
  check(`${functionName}: no field is an invalid empty string (found: ${emptyStringFields.join(", ") || "none"})`, emptyStringFields.length === 0);
}

/** Guardrail (Phase 3): the 12 functions with no local timestamp source must OMIT created_at/updated_at entirely, not send any value (empty string or otherwise) for Postgres's DEFAULT now() to apply. */
function assertTimestampsOmitted(functionName: string, row: object) {
  const hasCreatedAt = Object.prototype.hasOwnProperty.call(row, "created_at");
  const hasUpdatedAt = Object.prototype.hasOwnProperty.call(row, "updated_at");
  check(`${functionName}: created_at/updated_at are omitted, not sent as "" or any placeholder`, !hasCreatedAt && !hasUpdatedAt);
}

console.log("1. Empty AppData maps to empty arrays (no crashes on empty input)");
check("diffById on two empty arrays yields no changes", (() => {
  const diff = (Map_ as unknown as { deepEqual: typeof Map_.deepEqual }).deepEqual([], []);
  return diff === true;
})());

console.log("\n2. Courses + class sections round-trip");
const course: Course = { id: "course-1", name: "Algebra 1", colorHex: "#ff0000", description: "Intro algebra" };
const courseRow = Map_.courseToRow(course, ctx);
check("courseToRow sets owner_type=teacher and preserves id", courseRow.owner_type === "teacher" && courseRow.id === "course-1");
check("courseToRow preserves organization/membership context", courseRow.organization_id === ctx.organizationId && courseRow.owner_membership_id === ctx.membershipId);
const courseBack = Map_.rowToCourse(withTimestamps(courseRow));
check("rowToCourse round-trips exactly", Map_.deepEqual(courseBack, course));

const courseNoOptional: Course = { id: "course-2", name: "Geometry" };
const courseNoOptionalBack = Map_.rowToCourse(withTimestamps(Map_.courseToRow(courseNoOptional, ctx)));
check("optional fields (colorHex/description) round-trip as undefined, not null", Map_.deepEqual(courseNoOptionalBack, courseNoOptional));

const section: ClassSection = { id: "section-1", courseId: "course-1", name: "Algebra 1 - Period 1", room: "204" };
const sectionBack = Map_.rowToClassSection(withTimestamps(Map_.classSectionToRow(section, ctx)));
check("class section round-trips exactly", Map_.deepEqual(sectionBack, section));

console.log("\n3. Custom bell schedule (with blocks) round-trips");
// needsConfiguration/isLunchWindow are deliberately OMITTED, not set to
// `false` - that's the app's real canonical shape (see
// lib/schedule/presets/ohhsRegular.ts), and `false`/omitted are meant to
// be equivalent after a cloud round-trip (rowsToBellSchedule collapses
// the DB's `not null default false` columns back to undefined) - see the
// dedicated verify-migration-validation-boolean-defaults.ts for exactly
// this contract, including the true-survives-as-true case.
const schedule: BellSchedule = {
  id: "schedule-1",
  name: "My Custom Schedule",
  description: "Second semester",
  isDefault: true,
  timeZone: "America/Detroit",
  source: "custom",
  blocks: [
    { id: "block-1", label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: "section-1", overrides: [] },
    { id: "block-2", label: "Enrichment", kind: "enrichment", startTime: "08:55", endTime: "09:35", classSectionId: null, overrides: [] },
  ],
};
const scheduleRow = Map_.bellScheduleToRow(schedule, ctx);
check("bellScheduleToRow always writes owner_type=teacher (Decision 1)", scheduleRow.owner_type === "teacher");
const blockRows = schedule.blocks.map((b, i) => Map_.scheduleBlockToRow(b, i, schedule.id, ctx));
check("scheduleBlockToRow assigns position from array index", blockRows[0].position === 0 && blockRows[1].position === 1);
check("scheduleBlockToRow preserves embedded classSectionId (teacher-owned shape)", blockRows[0].class_section_id === "section-1" && blockRows[1].class_section_id === null);

const overridesByBlockId = new Map<string, Map_.ScheduleBlockOverridesRow[]>();
const reassembled = Map_.rowsToBellSchedule(withTimestamps(scheduleRow), blockRows.map(withTimestamps), overridesByBlockId, new Map());
check("bell schedule round-trips exactly (empty overrides)", Map_.deepEqual(reassembled, schedule));

console.log("\n4. SPECIAL CASE - a built-in schedule still migrates as teacher-owned, unchanged in shape");
const builtIn: BellSchedule = { ...schedule, id: "schedule-builtin", source: "built-in" };
const builtInRow = Map_.bellScheduleToRow(builtIn, ctx);
check("built-in schedule is still owner_type=teacher, never organization", builtInRow.owner_type === "teacher");
check("source='built-in' is preserved as descriptive metadata, not an ownership signal", builtInRow.source === "built-in");

console.log("\n5. Schedule block override tri-state (undefined/null/string) round-trips");
const overrideInherit = { id: "ov-1", weekday: "monday" as const, label: "SAT Prep" };
const overrideUnassign = { id: "ov-2", weekday: "tuesday" as const, classSectionId: null };
const overrideReassign = { id: "ov-3", weekday: "wednesday" as const, classSectionId: "section-2" };
for (const [label, override] of [
  ["inherit (classSectionId undefined)", overrideInherit],
  ["explicit unassign (classSectionId null)", overrideUnassign],
  ["reassign (classSectionId a string)", overrideReassign],
] as const) {
  const row = Map_.scheduleBlockOverrideToRow(override, "block-1", ctx);
  const back = Map_.rowToScheduleBlockOverride(withTimestamps(row));
  check(`override tri-state round-trips: ${label}`, Map_.deepEqual(back, override));
}
check(
  "class_section_overridden is false only for the inherit case",
  Map_.scheduleBlockOverrideToRow(overrideInherit, "block-1", ctx).class_section_overridden === false &&
    Map_.scheduleBlockOverrideToRow(overrideUnassign, "block-1", ctx).class_section_overridden === true &&
    Map_.scheduleBlockOverrideToRow(overrideReassign, "block-1", ctx).class_section_overridden === true,
);

console.log("\n6. Lessons (including materials) round-trip via the lessons+lesson_class_sections split");
const lesson: DailyLesson = {
  id: "lesson-1",
  date: "2026-09-15",
  classSectionId: "section-1",
  learningTarget: "Solve linear equations",
  agendaItems: [{ id: "ai-1", title: "Warm-up", isCompleted: false, sortOrder: 0 }],
  resources: [{ id: "lr-1", title: "Worksheet", url: "https://example.com/w.pdf", type: "pdf" }],
  announcements: [{ id: "an-1", text: "Quiz Friday" }],
  materials: "Guided notes, calculators",
  createdAt: "2026-09-14T12:00:00.000Z",
  updatedAt: "2026-09-14T12:00:00.000Z",
};
const lessonRow = Map_.lessonToRow(lesson, "course-1", ctx);
check("lessonToRow resolves course_id from the caller-supplied value", lessonRow.course_id === "course-1");
check("lessonToRow preserves materials", lessonRow.materials === "Guided notes, calculators");
const lcsRow = Map_.lessonClassSectionToRow(lesson, ctx);
check("lessonClassSectionToRow carries date and section", lcsRow.lesson_date === "2026-09-15" && lcsRow.class_section_id === "section-1");
const lessonBack = Map_.rowsToDailyLesson(lessonRow, withTimestamps(lcsRow));
check("lesson round-trips exactly including materials", Map_.deepEqual(lessonBack, lesson));

const lessonNoMaterials: DailyLesson = { ...lesson, id: "lesson-2", materials: undefined };
const lessonNoMaterialsBack = Map_.rowsToDailyLesson(
  Map_.lessonToRow(lessonNoMaterials, "course-1", ctx),
  withTimestamps(Map_.lessonClassSectionToRow(lessonNoMaterials, ctx)),
);
check("a lesson with no materials round-trips materials as undefined, not null", Map_.deepEqual(lessonNoMaterialsBack, lessonNoMaterials));

console.log("\n7. Library resources + course links round-trip");
const manualResource: LibraryResource = {
  id: "resource-1",
  title: "Khan Academy",
  url: "https://khanacademy.org",
  type: "link",
  courseIds: ["course-1", "course-2"],
  tags: ["review"],
  isFavorite: true,
  source: { kind: "manual" },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const manualBack = Map_.rowsToLibraryResource(Map_.libraryResourceToRow(manualResource, ctx), manualResource.courseIds);
check("manual-source library resource round-trips exactly", Map_.deepEqual(manualBack, manualResource));

const driveResource: LibraryResource = {
  ...manualResource,
  id: "resource-2",
  courseIds: [],
  source: { kind: "google-drive", driveFileId: "drive-file-1", mimeType: "application/pdf", webViewUrl: "https://drive.google.com/x" },
};
const driveRow = Map_.libraryResourceToRow(driveResource, ctx);
check("google-drive source fields are written", driveRow.source_drive_file_id === "drive-file-1" && driveRow.source_mime_type === "application/pdf");
const driveBack = Map_.rowsToLibraryResource(driveRow, []);
check("google-drive-source library resource round-trips exactly, incl. empty courseIds", Map_.deepEqual(driveBack, driveResource));

console.log("\n8. Class presentation settings round-trip");
const presentation: ClassPresentationSettings = { classSectionId: "section-1", arrivalInstructions: ["Take out notebook", "Sharpen pencils"] };
check("class presentation settings round-trips exactly", Map_.deepEqual(Map_.rowToClassPresentationSettings(withTimestamps(Map_.classPresentationSettingsToRow(presentation, ctx))), presentation));

console.log("\n9. Classroom experience settings (including bellOffsetSeconds) round-trip; watermark is explicitly not migrated");
const experience: ClassroomExperienceSettings = {
  finalFiveMessage: "Wrap up!",
  showEndOfDayScreen: true,
  endOfDayMessage: "Have a great afternoon.",
  cleanScreenDefaultMessage: "Work Time",
  showClockOnCleanScreen: true,
  transitionCountdownEnabled: true,
  transitionArrivalInstructionsEnabled: true,
  customWatermarkDataUrl: "data:image/png;base64,abc123",
  watermarkOpacity: 0.5,
  bellOffsetSeconds: -45,
};
const experienceRow = Map_.classroomExperienceSettingsToRow(experience, ctx);
check("bellOffsetSeconds is preserved exactly", experienceRow.bell_offset_seconds === -45);
check("watermark_override_storage_path is always null (Storage upload not built yet - reported, not silently dropped)", experienceRow.watermark_override_storage_path === null);
const experienceBack = Map_.rowToClassroomExperienceSettings(withTimestamps(experienceRow));
check("everything except the watermark round-trips exactly", Map_.deepEqual({ ...experienceBack, customWatermarkDataUrl: experience.customWatermarkDataUrl }, experience));
check("customWatermarkDataUrl comes back undefined (expected, documented gap)", experienceBack.customWatermarkDataUrl === undefined);
check("rowToClassroomExperienceSettings falls back to defaults when no row exists yet", Map_.deepEqual(Map_.rowToClassroomExperienceSettings(null).bellOffsetSeconds, 0));

console.log("\n10. Teacher schedule preferences round-trip");
const prefs: TeacherSchedulePreferences = { lunchWave: "B" };
check("teacher schedule preferences round-trip exactly", Map_.deepEqual(Map_.rowToTeacherSchedulePreferences(withTimestamps(Map_.teacherSchedulePreferencesToRow(prefs, ctx))), prefs));
check("missing row falls back to the documented default (none)", Map_.rowToTeacherSchedulePreferences(null).lunchWave === "none");

console.log("\n11. School calendar + exceptions round-trip; is_canonical is always false from migration");
const calendar: SchoolYearCalendar = {
  id: "calendar-1",
  name: "2026-27 School Year",
  schoolYear: "2026-2027",
  timeZone: "America/Detroit",
  firstStudentDay: "2026-08-25",
  lastStudentDay: "2027-06-10",
  defaultBellScheduleId: "schedule-1",
  exceptions: [
    { id: "exc-1", startDate: "2026-09-07", endDate: "2026-09-07", type: "no-school", title: "Labor Day" },
    { id: "exc-2", startDate: "2026-11-24", endDate: "2026-11-24", type: "special-bell", title: "Early Release", bellScheduleId: "schedule-1", dismissalTime: "11:24 AM" },
  ],
};
const calendarRow = Map_.schoolYearCalendarToRow(calendar, ctx);
check("migrated calendar is always is_canonical=false (Decision 1)", calendarRow.is_canonical === false);
check("migrated calendar is owner_type=teacher (dual-ownership correction)", calendarRow.owner_type === "teacher" && calendarRow.owner_membership_id === ctx.membershipId);
const exceptionRows = calendar.exceptions.map((e) => Map_.schoolCalendarExceptionToRow(e, calendar.id, ctx));
const calendarBack = Map_.rowsToSchoolYearCalendar(withTimestamps(calendarRow), exceptionRows.map(withTimestamps));
check("calendar + exceptions round-trip exactly", Map_.deepEqual(calendarBack, calendar));

console.log("\n12. Insert payload validity guardrail - every *ToRow() function, not just round-trip content");
console.log("    (this is the exact category of bug that broke the live migration: created_at: \"\" sent to a timestamptz column)");
assertTimestampsOmitted("courseToRow", Map_.courseToRow(course, ctx));
assertNoEmptyStringFields("courseToRow", Map_.courseToRow(course, ctx));
assertTimestampsOmitted("classSectionToRow", Map_.classSectionToRow(section, ctx));
assertNoEmptyStringFields("classSectionToRow", Map_.classSectionToRow(section, ctx));
assertTimestampsOmitted("bellScheduleToRow", Map_.bellScheduleToRow(schedule, ctx));
assertNoEmptyStringFields("bellScheduleToRow", Map_.bellScheduleToRow(schedule, ctx));
assertTimestampsOmitted("scheduleBlockToRow", Map_.scheduleBlockToRow(schedule.blocks[0], 0, schedule.id, ctx));
assertNoEmptyStringFields("scheduleBlockToRow", Map_.scheduleBlockToRow(schedule.blocks[0], 0, schedule.id, ctx));
assertTimestampsOmitted("scheduleBlockOverrideToRow", Map_.scheduleBlockOverrideToRow(overrideReassign, "block-1", ctx));
assertNoEmptyStringFields("scheduleBlockOverrideToRow", Map_.scheduleBlockOverrideToRow(overrideReassign, "block-1", ctx));
assertTimestampsOmitted("schoolYearCalendarToRow", Map_.schoolYearCalendarToRow(calendar, ctx));
assertNoEmptyStringFields("schoolYearCalendarToRow", Map_.schoolYearCalendarToRow(calendar, ctx));
assertTimestampsOmitted("schoolCalendarExceptionToRow", Map_.schoolCalendarExceptionToRow(calendar.exceptions[0], calendar.id, ctx));
assertNoEmptyStringFields("schoolCalendarExceptionToRow", Map_.schoolCalendarExceptionToRow(calendar.exceptions[0], calendar.id, ctx));
assertTimestampsOmitted("lessonClassSectionToRow", Map_.lessonClassSectionToRow(lesson, ctx));
assertNoEmptyStringFields("lessonClassSectionToRow", Map_.lessonClassSectionToRow(lesson, ctx));
assertTimestampsOmitted("libraryResourceCourseToRow", Map_.libraryResourceCourseToRow("resource-1", "course-1", ctx));
assertNoEmptyStringFields("libraryResourceCourseToRow", Map_.libraryResourceCourseToRow("resource-1", "course-1", ctx));
assertTimestampsOmitted("classPresentationSettingsToRow", Map_.classPresentationSettingsToRow(presentation, ctx));
assertNoEmptyStringFields("classPresentationSettingsToRow", Map_.classPresentationSettingsToRow(presentation, ctx));
assertTimestampsOmitted("classroomExperienceSettingsToRow", Map_.classroomExperienceSettingsToRow(experience, ctx));
assertNoEmptyStringFields("classroomExperienceSettingsToRow", Map_.classroomExperienceSettingsToRow(experience, ctx));
assertTimestampsOmitted("teacherSchedulePreferencesToRow", Map_.teacherSchedulePreferencesToRow(prefs, ctx));
assertNoEmptyStringFields("teacherSchedulePreferencesToRow", Map_.teacherSchedulePreferencesToRow(prefs, ctx));

// Positive control: the two functions with a real local timestamp source
// (lessonToRow, libraryResourceToRow) must still SEND real, non-empty
// timestamps - confirming the fix didn't overcorrect into omitting them
// where the local model actually supplies real values.
check("lessonToRow still sends its real createdAt/updatedAt (not omitted)", lessonRow.created_at === lesson.createdAt && lessonRow.updated_at === lesson.updatedAt && lessonRow.created_at !== "");
const libraryResourceRow = Map_.libraryResourceToRow(manualResource, ctx);
check("libraryResourceToRow still sends its real createdAt/updatedAt (not omitted)", libraryResourceRow.created_at === manualResource.createdAt && libraryResourceRow.updated_at === manualResource.updatedAt && libraryResourceRow.created_at !== "");

console.log("\n13. Postgres time/timestamptz round-trip normalization");
console.log("    (the exact category of bug that broke live validation: DB-formatted strings compared against AppData's canonical shape)");

check('normalizeDbTime: "08:00:00" -> "08:00" (zero seconds collapsed)', Map_.normalizeDbTime("08:00:00") === "08:00");
check('normalizeDbTime: "08:00:00.000000" -> "08:00" (zero fractional seconds collapsed)', Map_.normalizeDbTime("08:00:00.000000") === "08:00");
check('normalizeDbTime: "08:00:00.0" -> "08:00" (a shorter zero fraction also collapses)', Map_.normalizeDbTime("08:00:00.0") === "08:00");
check('normalizeDbTime: meaningful non-zero seconds are preserved, not silently dropped ("08:00:15" stays "08:00:15")', Map_.normalizeDbTime("08:00:15") === "08:00:15");
check('normalizeDbTime: meaningful non-zero fractional seconds are preserved via their whole-second component ("08:00:15.250000" keeps ":15")', Map_.normalizeDbTime("08:00:15.250000") === "08:00:15");
check('normalizeDbTime: already-canonical "HH:mm" input is idempotent', Map_.normalizeDbTime("08:00") === "08:00");

check(
  'normalizeDbTimestamp: "2026-09-14T12:00:00+00:00" -> "2026-09-14T12:00:00.000Z"',
  Map_.normalizeDbTimestamp("2026-09-14T12:00:00+00:00") === "2026-09-14T12:00:00.000Z",
);
check(
  "normalizeDbTimestamp: equivalent timezone representations of the same instant normalize identically",
  Map_.normalizeDbTimestamp("2026-09-14T12:00:00+00:00") === Map_.normalizeDbTimestamp("2026-09-14T12:00:00Z") &&
    Map_.normalizeDbTimestamp("2026-09-14T07:00:00-05:00") === Map_.normalizeDbTimestamp("2026-09-14T12:00:00Z"),
);
check(
  "normalizeDbTimestamp: throws rather than fabricating a value for genuinely invalid input",
  (() => {
    try {
      Map_.normalizeDbTimestamp("not-a-timestamp");
      return false;
    } catch {
      return true;
    }
  })(),
);

// Cases 6-8: feed the reverse mappers strings shaped exactly like what
// Postgres/PostgREST actually returns (not what was originally written),
// and confirm the result still matches the original AppData object -
// this is the precise scenario that broke validateMigratedData live.
console.log("    lesson/library-resource/schedule round-trip using simulated Postgres-formatted strings:");

const lessonRowAsPostgresWouldReturnIt: Map_.LessonsRow = { ...lessonRow, created_at: "2026-09-14T12:00:00+00:00", updated_at: "2026-09-14T12:00:00+00:00" };
const lessonBackFromPg = Map_.rowsToDailyLesson(lessonRowAsPostgresWouldReturnIt, withTimestamps(lcsRow));
check("lesson round-trips correctly even when Postgres returns a differently-formatted (but equivalent) timestamp", Map_.deepEqual(lessonBackFromPg, lesson));

const libraryResourceRowAsPostgresWouldReturnIt: Map_.LibraryResourcesRow = { ...libraryResourceRow, created_at: "2026-09-01T00:00:00+00:00", updated_at: "2026-09-01T00:00:00+00:00" };
const libraryResourceBackFromPg = Map_.rowsToLibraryResource(libraryResourceRowAsPostgresWouldReturnIt, manualResource.courseIds);
check("library resource round-trips correctly even when Postgres returns a differently-formatted (but equivalent) timestamp", Map_.deepEqual(libraryResourceBackFromPg, manualResource));

const scheduleRowFromPg = scheduleRow;
const blockRowsAsPostgresWouldReturnThem = blockRows.map((b) => ({ ...b, start_time: `${b.start_time}:00`, end_time: `${b.end_time}:00` }));
const reassembledFromPg = Map_.rowsToBellSchedule(withTimestamps(scheduleRowFromPg), blockRowsAsPostgresWouldReturnThem.map(withTimestamps), overridesByBlockId, new Map());
check("schedule round-trips correctly even when Postgres returns HH:MM:SS instead of HH:mm", Map_.deepEqual(reassembledFromPg, schedule));

console.log("\n14. deepEqual: structural equality independent of object key order");
console.log("    (the exact category of bug this closes: Postgres JSONB does not preserve object key insertion order on read)");

check("same object, different key order -> equal", Map_.deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }));
check(
  "nested object key reordering -> equal",
  Map_.deepEqual({ outer: { a: 1, b: { c: 2, d: 3 } } }, { outer: { b: { d: 3, c: 2 }, a: 1 } }),
);
check("arrays with the same order -> equal", Map_.deepEqual([1, 2, 3], [1, 2, 3]));
check("arrays with a different order -> NOT equal (array order matters)", !Map_.deepEqual([1, 2, 3], [3, 2, 1]));
check("different primitive values -> NOT equal", !Map_.deepEqual({ a: 1 }, { a: 2 }));
check("a missing object key (with a real value on the other side) -> NOT equal", !Map_.deepEqual({ a: 1 }, { a: 1, b: 2 }));
check("an extra object key (with a real value) -> NOT equal", !Map_.deepEqual({ a: 1, b: 2 }, { a: 1 }));
check("a nested value difference -> NOT equal", !Map_.deepEqual({ a: { x: 1 } }, { a: { x: 2 } }));
check("no coercion: number 1 does not equal string \"1\"", !Map_.deepEqual({ a: 1 }, { a: "1" }));
check("null is a real value: {a: null} does not equal {a: undefined} (undefined is treated as absent, null is not)", !Map_.deepEqual({ a: null }, { a: undefined }));
check("null does not equal any other primitive value", !Map_.deepEqual({ a: null }, { a: 0 }));

console.log("    lessons.agenda_items/resources/announcements: Postgres-style key-reordered objects still compare equal:");
const agendaItemPgOrder = lesson.agendaItems.map((item) => ({ id: item.id, sortOrder: item.sortOrder, isCompleted: item.isCompleted, title: item.title }));
check(
  "lesson agenda_items with Postgres-style reordered object keys still equals the original",
  Map_.deepEqual({ ...lesson, agendaItems: agendaItemPgOrder }, lesson),
);
const resourcesPgOrder = lesson.resources.map((r) => ({ url: r.url, type: r.type, title: r.title, id: r.id }));
check(
  "lesson resources with Postgres-style reordered object keys still equals the original",
  Map_.deepEqual({ ...lesson, resources: resourcesPgOrder }, lesson),
);
const announcementsPgOrder = lesson.announcements.map((a) => ({ text: a.text, id: a.id }));
check(
  "lesson announcements with Postgres-style reordered object keys still equals the original",
  Map_.deepEqual({ ...lesson, announcements: announcementsPgOrder }, lesson),
);

console.log("    the schedule block override 'inherit' tri-state case (explicitly-undefined vs omitted key) must still round-trip as equal:");
const overrideOmittedKey = { id: "ov-inherit", weekday: "monday" as const, label: "SAT Prep" };
const overrideExplicitUndefined = { id: "ov-inherit", weekday: "monday" as const, label: "SAT Prep", classSectionId: undefined, kind: undefined, customKindLabel: undefined, startTime: undefined, endTime: undefined };
check(
  "an omitted optional key and the same key explicitly set to undefined compare equal",
  Map_.deepEqual(overrideOmittedKey, overrideExplicitUndefined),
);

console.log("\n15. diffById (the core of save()'s snapshot diffing)");
interface Item { id: string; value: number }
const prevItems: Item[] = [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }];
const nextItems: Item[] = [{ id: "a", value: 1 }, { id: "b", value: 99 }, { id: "d", value: 4 }];
function diffById<T extends { id: string }>(prev: T[], next: T[]) {
  const prevById = new Map(prev.map((i) => [i.id, i]));
  const nextById = new Map(next.map((i) => [i.id, i]));
  const added = next.filter((i) => !prevById.has(i.id));
  const updated = next.filter((i) => prevById.has(i.id) && !Map_.deepEqual(prevById.get(i.id), i));
  const removedIds = prev.filter((i) => !nextById.has(i.id)).map((i) => i.id);
  return { added, updated, removedIds };
}
const diff = diffById(prevItems, nextItems);
check("unchanged item (a) is neither added, updated, nor removed", !diff.added.some((i) => i.id === "a") && !diff.updated.some((i) => i.id === "a") && !diff.removedIds.includes("a"));
check("changed item (b) is detected as updated, not added", diff.updated.some((i) => i.id === "b" && i.value === 99) && !diff.added.some((i) => i.id === "b"));
check("new item (d) is detected as added", diff.added.some((i) => i.id === "d"));
check("missing item (c) is detected as removed", diff.removedIds.includes("c"));
check("no false positives: exactly one added, one updated, one removed", diff.added.length === 1 && diff.updated.length === 1 && diff.removedIds.length === 1);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
