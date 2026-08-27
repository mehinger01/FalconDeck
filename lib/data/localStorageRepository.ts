import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";
import { createDemoAppData } from "./demoData";
import type { AppData, DataRepository, SaveResult } from "./types";

const STORAGE_KEY = "falcon-deck:app-data:v1";
const DEFAULT_SCHEDULE_KEY = "falcon-deck:default-schedule-id:v1";

function readStoredData(): Partial<AppData> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<AppData>) : null;
  } catch {
    return null;
  }
}

function readStoredDefaultScheduleId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DEFAULT_SCHEDULE_KEY);
  } catch {
    return null;
  }
}

export function saveDefaultScheduleSelection(scheduleId: string): SaveResult {
  if (typeof window === "undefined") {
    return { ok: false, reason: "unavailable", message: "Storage is unavailable in this environment." };
  }

  try {
    window.localStorage.setItem(DEFAULT_SCHEDULE_KEY, scheduleId);
    return { ok: true };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return { ok: false, reason: "quota-exceeded", message: "Local storage is full." };
    }
    return { ok: false, reason: "unknown", message: "Storage may be unavailable (e.g. private browsing)." };
  }
}

/** Firefox/Safari report quota exceeded as DOMException name "QuotaExceededError"; older Safari uses code 22, older Firefox code 1014. */
function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014;
}

function writeStoredData(data: AppData): SaveResult {
  if (typeof window === "undefined") {
    return { ok: false, reason: "unavailable", message: "Storage is unavailable in this environment." };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return { ok: false, reason: "serialization-failed", message: "Couldn't prepare this data to be saved." };
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    return { ok: true };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      return { ok: false, reason: "quota-exceeded", message: "Local storage is full." };
    }
    return { ok: false, reason: "unknown", message: "Storage may be unavailable (e.g. private browsing)." };
  }
}

/**
 * Phase 1's `DataRepository`: persists to the browser's localStorage,
 * seeding first launch (or an explicit reset, via `RESET_TO_DEMO`) with the
 * demo data set. A future `SupabaseDataRepository` implements the same
 * interface and persists remotely instead - nothing above the repository
 * layer (the store, the UI) needs to change when that swap happens.
 */
export class LocalStorageDataRepository implements DataRepository {
  async load(): Promise<AppData> {
    const stored = readStoredData();
    if (!stored) return createDemoAppData();

    const savedDefaultScheduleId = readStoredDefaultScheduleId();
    const schedules = stored.schedules ?? [];
    const normalizedSchedules =
      savedDefaultScheduleId && schedules.some((schedule) => schedule.id === savedDefaultScheduleId)
        ? schedules.map((schedule) => ({
            ...schedule,
            isDefault: schedule.id === savedDefaultScheduleId,
          }))
        : schedules;

    // Defensive defaults for data saved by an earlier schema version (e.g.
    // pre-Phase-2, before `lessons` existed) - avoids a hard crash on
    // .map/.filter over a missing field for anyone with existing local data.
    return {
      courses: stored.courses ?? [],
      classSections: stored.classSections ?? [],
      schedules: normalizedSchedules,
      lessons: stored.lessons ?? [],
      classPresentationSettings: stored.classPresentationSettings ?? [],
      classroomExperienceSettings: {
        ...DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
        ...stored.classroomExperienceSettings,
      },
      libraryResources: stored.libraryResources ?? [],
      teacherSchedulePreferences: {
        ...DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
        ...stored.teacherSchedulePreferences,
      },
      schoolCalendar: stored.schoolCalendar ?? null,
    };
  }

  async save(data: AppData): Promise<SaveResult> {
    return writeStoredData(data);
  }

  subscribeToExternalChanges(onChange: () => void): () => void {
    if (typeof window === "undefined") return () => {};

    // The browser's `storage` event fires only in *other* tabs/windows of
    // this origin, never in the document that made the write - that's what
    // keeps this from looping back on itself.
    function handleStorageEvent(event: StorageEvent) {
      // event.key is null when localStorage.clear() was called elsewhere -
      // treat that as "something changed" too, not just our own keys.
      if (event.key !== null && event.key !== STORAGE_KEY && event.key !== DEFAULT_SCHEDULE_KEY) return;
      onChange();
    }

    window.addEventListener("storage", handleStorageEvent);
    return () => window.removeEventListener("storage", handleStorageEvent);
  }
}

export const dataRepository: DataRepository = new LocalStorageDataRepository();
