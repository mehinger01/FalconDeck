import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";
import { clampBellOffsetSeconds } from "@/lib/schedule/time";
import type { AppData } from "@/lib/data/types";
import { dataRepository, saveDefaultScheduleSelection } from "@/lib/data/localStorageRepository";
import { deepEqual } from "@/lib/data/supabaseMapping";
import { BACKUP_FORMAT_VERSION } from "./downloadBackup";

/**
 * Parses, validates, and restores a downloaded Falcon Deck backup - the
 * read half of downloadBackup.ts's write-only export. Deliberately narrow:
 * this module ONLY ever targets `dataRepository` (the local, browser
 * singleton from lib/data/localStorageRepository.ts) - never a Supabase
 * client, never a generic injected `DataRepository`. Genericizing over
 * `DataRepository` here would make it possible for a caller to accidentally
 * point a restore at a cloud repository; hardcoding the import instead
 * makes that structurally impossible, not just a convention callers have
 * to remember. Callers are responsible for only ever reaching this UI when
 * the current DataAuthorityState is "local" - see RestoreBackupCard.
 *
 * Never restores into Supabase, never mutates local_data_migrated_at, and
 * never triggers a migration - restoring only ever writes to the same
 * localStorage key regular local saves already use.
 */

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface BackupMetadata {
  backupFormatVersion: number;
  exportedAt: string;
}

export type BackupValidationResult =
  | { ok: true; data: AppData; metadata: BackupMetadata }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Checks the handful of things that make a parsed JSON value plausible as
 * Falcon Deck's AppData - not a full schema validator (see this module's
 * doc comment on scope), just enough to reject "obviously wrong type" and
 * "malformed required ids/dates" before anything is ever written to
 * localStorage. Returns an error string, or null if the shape is
 * acceptable. Deliberately tolerant of MISSING optional top-level fields -
 * `normalizeParsedAppData` below fills those in with the exact same
 * defaults LocalStorageDataRepository.load() already applies to older
 * saves, rather than requiring every field to be present here.
 */
function validateAppDataShape(value: Record<string, unknown>): string | null {
  const courses = value.courses;
  if (courses !== undefined) {
    if (!Array.isArray(courses)) return "This backup's course list is the wrong shape.";
    for (const course of courses) {
      if (!isPlainObject(course) || !isNonEmptyString(course.id) || !isNonEmptyString(course.name)) {
        return "This backup contains a course with a missing or invalid id/name.";
      }
    }
  }

  const classSections = value.classSections;
  if (classSections !== undefined) {
    if (!Array.isArray(classSections)) return "This backup's class section list is the wrong shape.";
    for (const section of classSections) {
      if (
        !isPlainObject(section) ||
        !isNonEmptyString(section.id) ||
        !isNonEmptyString(section.courseId) ||
        !isNonEmptyString(section.name)
      ) {
        return "This backup contains a class section with a missing or invalid id/course/name.";
      }
    }
  }

  const schedules = value.schedules;
  if (schedules !== undefined) {
    if (!Array.isArray(schedules)) return "This backup's schedule list is the wrong shape.";
    for (const schedule of schedules) {
      if (!isPlainObject(schedule) || !isNonEmptyString(schedule.id) || !isNonEmptyString(schedule.name)) {
        return "This backup contains a schedule with a missing or invalid id/name.";
      }
      if (typeof schedule.isDefault !== "boolean") return `Schedule "${String(schedule.name)}" is missing its default flag.`;
      if (schedule.blocks !== undefined) {
        if (!Array.isArray(schedule.blocks)) return `Schedule "${String(schedule.name)}"'s blocks are the wrong shape.`;
        for (const block of schedule.blocks) {
          if (!isPlainObject(block) || !isNonEmptyString(block.id) || !isNonEmptyString(block.startTime) || !isNonEmptyString(block.endTime)) {
            return `Schedule "${String(schedule.name)}" contains a block with a missing or invalid id/time.`;
          }
          if (block.overrides !== undefined && !Array.isArray(block.overrides)) {
            return `Schedule "${String(schedule.name)}"'s block overrides are the wrong shape.`;
          }
        }
      }
    }
    if (schedules.length > 0 && !schedules.some((s) => isPlainObject(s) && s.isDefault === true)) {
      return "This backup's schedules don't have exactly one marked as default.";
    }
  }

  const lessons = value.lessons;
  if (lessons !== undefined) {
    if (!Array.isArray(lessons)) return "This backup's lesson list is the wrong shape.";
    for (const lesson of lessons) {
      if (
        !isPlainObject(lesson) ||
        !isNonEmptyString(lesson.id) ||
        !isNonEmptyString(lesson.date) ||
        !isNonEmptyString(lesson.classSectionId)
      ) {
        return "This backup contains a lesson with a missing or invalid id/date/class section.";
      }
      if (lesson.createdAt !== undefined && !isValidDateString(lesson.createdAt)) {
        return `Lesson ${String(lesson.id)} has an invalid createdAt timestamp.`;
      }
      if (lesson.updatedAt !== undefined && !isValidDateString(lesson.updatedAt)) {
        return `Lesson ${String(lesson.id)} has an invalid updatedAt timestamp.`;
      }
    }
  }

  const libraryResources = value.libraryResources;
  if (libraryResources !== undefined) {
    if (!Array.isArray(libraryResources)) return "This backup's resource library is the wrong shape.";
    for (const resource of libraryResources) {
      if (!isPlainObject(resource) || !isNonEmptyString(resource.id) || !isNonEmptyString(resource.title) || !isNonEmptyString(resource.url)) {
        return "This backup contains a library resource with a missing or invalid id/title/url.";
      }
      if (resource.createdAt !== undefined && !isValidDateString(resource.createdAt)) {
        return `Library resource ${String(resource.id)} has an invalid createdAt timestamp.`;
      }
      if (resource.updatedAt !== undefined && !isValidDateString(resource.updatedAt)) {
        return `Library resource ${String(resource.id)} has an invalid updatedAt timestamp.`;
      }
    }
  }

  const classPresentationSettings = value.classPresentationSettings;
  if (classPresentationSettings !== undefined) {
    if (!Array.isArray(classPresentationSettings)) return "This backup's presentation settings are the wrong shape.";
    for (const setting of classPresentationSettings) {
      if (!isPlainObject(setting) || !isNonEmptyString(setting.classSectionId)) {
        return "This backup contains presentation settings with a missing class section id.";
      }
    }
  }

  if (value.classroomExperienceSettings !== undefined && !isPlainObject(value.classroomExperienceSettings)) {
    return "This backup's classroom experience settings are the wrong shape.";
  }

  if (value.teacherSchedulePreferences !== undefined && !isPlainObject(value.teacherSchedulePreferences)) {
    return "This backup's teacher schedule preferences are the wrong shape.";
  }

  const schoolCalendar = value.schoolCalendar;
  if (schoolCalendar !== undefined && schoolCalendar !== null) {
    if (!isPlainObject(schoolCalendar) || !isNonEmptyString(schoolCalendar.id) || !isNonEmptyString(schoolCalendar.defaultBellScheduleId)) {
      return "This backup's school calendar is missing a required id/default schedule.";
    }
    if (schoolCalendar.exceptions !== undefined) {
      if (!Array.isArray(schoolCalendar.exceptions)) return "This backup's calendar exceptions are the wrong shape.";
      for (const exception of schoolCalendar.exceptions) {
        if (!isPlainObject(exception) || !isNonEmptyString(exception.id) || !isNonEmptyString(exception.startDate) || !isNonEmptyString(exception.endDate)) {
          return "This backup contains a calendar exception with a missing or invalid id/date.";
        }
      }
    }
  }

  return null;
}

/**
 * Fills in the exact same defaults LocalStorageDataRepository.load()
 * applies to an older/partial save, so the AppData this hands back is
 * already in the "shape load() would produce" - restoreBackupToLocal's
 * post-write verification compares against load()'s real output, and this
 * keeps that comparison meaningful instead of flagging an absent optional
 * array as a false mismatch against load()'s `?? []` default.
 */
function normalizeParsedAppData(value: Record<string, unknown>): AppData {
  return {
    courses: (value.courses as AppData["courses"] | undefined) ?? [],
    classSections: (value.classSections as AppData["classSections"] | undefined) ?? [],
    schedules: (value.schedules as AppData["schedules"] | undefined) ?? [],
    lessons: (value.lessons as AppData["lessons"] | undefined) ?? [],
    classPresentationSettings: (value.classPresentationSettings as AppData["classPresentationSettings"] | undefined) ?? [],
    classroomExperienceSettings: {
      ...DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
      ...(value.classroomExperienceSettings as Partial<AppData["classroomExperienceSettings"]> | undefined),
      bellOffsetSeconds: clampBellOffsetSeconds(
        (value.classroomExperienceSettings as Partial<AppData["classroomExperienceSettings"]> | undefined)?.bellOffsetSeconds ??
          DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS.bellOffsetSeconds,
      ),
    },
    libraryResources: (value.libraryResources as AppData["libraryResources"] | undefined) ?? [],
    teacherSchedulePreferences: {
      ...DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
      ...(value.teacherSchedulePreferences as Partial<AppData["teacherSchedulePreferences"]> | undefined),
    },
    schoolCalendar: (value.schoolCalendar as AppData["schoolCalendar"] | undefined) ?? null,
  };
}

/** Pure - never touches localStorage. Safe to call for every file the user picks, valid or not. */
export function validateBackup(raw: unknown): BackupValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "This doesn't look like a Falcon Deck backup file." };
  }

  if (typeof raw.backupFormatVersion !== "number") {
    return { ok: false, error: "This file has no backup format version - it doesn't look like a Falcon Deck backup." };
  }
  if (raw.backupFormatVersion > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      error: `This backup was created by a newer version of Falcon Deck (format ${raw.backupFormatVersion}) than this app understands (format ${BACKUP_FORMAT_VERSION}). Update Falcon Deck before restoring it.`,
    };
  }
  if (!isValidDateString(raw.exportedAt)) {
    return { ok: false, error: "This backup's export timestamp is missing or invalid." };
  }
  if (!isPlainObject(raw.appData)) {
    return { ok: false, error: "This backup has no Falcon Deck data in it." };
  }

  const shapeError = validateAppDataShape(raw.appData);
  if (shapeError) return { ok: false, error: shapeError };

  return {
    ok: true,
    data: normalizeParsedAppData(raw.appData),
    metadata: { backupFormatVersion: raw.backupFormatVersion, exportedAt: raw.exportedAt },
  };
}

/** Never throws a raw JSON.parse error into the UI - malformed JSON becomes an ordinary validation failure. */
export function parseBackup(text: string): BackupValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't valid JSON." };
  }
  return validateBackup(raw);
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export type RestoreResult = { ok: true } | { ok: false; error: string; rolledBack: boolean };

/** The calendar's defaultBellScheduleId repair load() performs whenever DEFAULT_SCHEDULE_KEY names a schedule that exists - see that file's own comment ("treat the explicit saved default selection as canonical"). Applied here too so the verification step compares against what load() will actually produce, not the pre-repair input. */
function withDefaultScheduleRepair(data: AppData, defaultScheduleId: string | null): AppData {
  if (!defaultScheduleId || !data.schoolCalendar) return data;
  return { ...data, schoolCalendar: { ...data.schoolCalendar, defaultBellScheduleId: defaultScheduleId } };
}

/**
 * Snapshot-atomic from Falcon Deck's perspective: captures the current
 * local snapshot (and its active default-schedule id) before writing
 * anything, and if the post-write read-back doesn't match what was just
 * written, restores that captured snapshot rather than leaving storage in
 * an uncertain state.
 *
 * `dataRepository.save()` itself is already atomic at the localStorage-key
 * level (a single `setItem` call - it either fully replaces the value or
 * throws without changing it), so a save() failure alone can never
 * partially overwrite anything; the explicit rollback path here exists
 * only for the rarer case where save() reports success but the subsequent
 * load() disagrees with it.
 *
 * Also explicitly restores `falcon-deck:default-schedule-id:v1` to match
 * the restored data's own default schedule, BEFORE the verification
 * load() runs - load()'s "repair" logic reads that key on every load, so
 * leaving a stale, unrelated value there could otherwise silently override
 * the just-restored schedules' isDefault flags (or the calendar's
 * defaultBellScheduleId) during verification. The backup format itself
 * doesn't need a new field for this: each schedule's own `isDefault` flag
 * already carries the information; restoring it just needs to also update
 * this second, independently-persisted key so the two stay consistent.
 */
export async function restoreBackupToLocal(restoredData: AppData): Promise<RestoreResult> {
  const previousData = await dataRepository.load();
  const previousDefaultScheduleId = previousData.schedules.find((s) => s.isDefault)?.id ?? null;

  const saveResult = await dataRepository.save(restoredData);
  if (!saveResult.ok) {
    return { ok: false, error: saveResult.message, rolledBack: false };
  }

  const restoredDefaultScheduleId = restoredData.schedules.find((s) => s.isDefault)?.id ?? null;
  saveDefaultScheduleSelection(restoredDefaultScheduleId ?? "");

  const reloaded = await dataRepository.load();
  const expected = withDefaultScheduleRepair(restoredData, restoredDefaultScheduleId);
  if (!deepEqual(reloaded, expected)) {
    const rollbackSave = await dataRepository.save(previousData);
    saveDefaultScheduleSelection(previousDefaultScheduleId ?? "");
    return {
      ok: false,
      error: "Restore verification failed - the data read back didn't match what was restored.",
      rolledBack: rollbackSave.ok,
    };
  }

  return { ok: true };
}
