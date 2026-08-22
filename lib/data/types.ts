import type { BellSchedule } from "@/types/schedule";
import type { ClassSection, Course } from "@/types/course";
import type { DailyLesson } from "@/types/lesson";
import type { ClassPresentationSettings, ClassroomExperienceSettings } from "@/types/classPresentation";
import type { LibraryResource } from "@/types/resource";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import type { SchoolYearCalendar } from "@/types/calendar";

export interface AppData {
  courses: Course[];
  classSections: ClassSection[];
  schedules: BellSchedule[];
  lessons: DailyLesson[];
  classPresentationSettings: ClassPresentationSettings[];
  classroomExperienceSettings: ClassroomExperienceSettings;
  libraryResources: LibraryResource[];
  teacherSchedulePreferences: TeacherSchedulePreferences;
  /** `null` = no Master Calendar imported yet - fully supported; Live Present Mode falls back to whichever BellSchedule is marked default. */
  schoolCalendar: SchoolYearCalendar | null;
}

/** A reason code callers can use to tailor messaging (e.g. "try a smaller image" only makes sense for quota-exceeded). */
export type SaveFailureReason = "quota-exceeded" | "unavailable" | "serialization-failed" | "unknown";

export type SaveResult = { ok: true } | { ok: false; reason: SaveFailureReason; message: string };

/**
 * Abstraction over where Falcon Deck's data lives. Phase 1 ships only
 * `LocalStorageDataRepository` (browser localStorage, seeded with demo data,
 * no network/auth required). A future `SupabaseDataRepository` can
 * implement this same interface without any changes to the store or UI
 * that consume it - `load`/`save` are async on purpose, even though the
 * localStorage implementation resolves synchronously under the hood.
 */
export interface DataRepository {
  load(): Promise<AppData>;
  /** Resolves with the outcome rather than throwing or silently swallowing failures - callers that only care about "did it work" can ignore the result, same as when this returned `Promise<void>`. */
  save(data: AppData): Promise<SaveResult>;
  /**
   * Notifies `onChange` when AppData changes from *outside* this tab/window
   * (e.g. another Falcon Deck tab saving) - never fires for this tab's own
   * writes, so callers don't need to guard against self-triggered loops.
   * Returns an unsubscribe function. A repository with no cross-tab
   * mechanism can return a no-op unsubscribe and simply never call back.
   */
  subscribeToExternalChanges(onChange: () => void): () => void;
}
