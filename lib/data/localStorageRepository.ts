import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import { createDemoAppData } from "./demoData";
import type { AppData, DataRepository } from "./types";

const STORAGE_KEY = "falcon-deck:app-data:v1";

function readStoredData(): Partial<AppData> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<AppData>) : null;
  } catch {
    return null;
  }
}

function writeStoredData(data: AppData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage may be unavailable (private browsing, quota exceeded) - not fatal.
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
    // Defensive defaults for data saved by an earlier schema version (e.g.
    // pre-Phase-2, before `lessons` existed) - avoids a hard crash on
    // .map/.filter over a missing field for anyone with existing local data.
    return {
      courses: stored.courses ?? [],
      classSections: stored.classSections ?? [],
      schedules: stored.schedules ?? [],
      lessons: stored.lessons ?? [],
      classPresentationSettings: stored.classPresentationSettings ?? [],
      classroomExperienceSettings: {
        ...DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
        ...stored.classroomExperienceSettings,
      },
      libraryResources: stored.libraryResources ?? [],
    };
  }

  async save(data: AppData): Promise<void> {
    writeStoredData(data);
  }
}

export const dataRepository: DataRepository = new LocalStorageDataRepository();
