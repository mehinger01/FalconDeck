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
 * What `subscribeToExternalChanges` is reporting - kept as a plain
 * discriminated union (not a boolean/inferred-from-a-failed-load signal)
 * so a repository can tell AppDataProvider exactly which of two very
 * different things happened:
 *
 * - "data-changed": the same authority is still valid; go reload and show
 *   it (LocalStorageDataRepository's cross-tab `storage` event).
 * - "session-ended": the authority itself is no longer valid (e.g. a
 *   Supabase SIGNED_OUT event) - never reload-and-hope, always a distinct,
 *   blocking "your session ended, sign in again" state. Trying to infer
 *   this from a load() rejection instead would conflate it with an
 *   ordinary transient network failure, which needs a different UI
 *   (Retry makes sense for one, never for the other).
 */
export type ExternalChangeEvent = "data-changed" | "session-ended";

/**
 * Abstraction over where Falcon Deck's data lives. Phase 1 ships only
 * `LocalStorageDataRepository` (browser localStorage, seeded with demo data,
 * no network/auth required). `SupabaseDataRepository` implements this same
 * interface without any changes to the store or UI that consume it -
 * `load`/`save` are async on purpose, even though the localStorage
 * implementation resolves synchronously under the hood.
 */
export interface DataRepository {
  load(): Promise<AppData>;
  /** Resolves with the outcome rather than throwing or silently swallowing failures - callers that only care about "did it work" can ignore the result, same as when this returned `Promise<void>`. */
  save(data: AppData): Promise<SaveResult>;
  /**
   * Notifies `onEvent` when something changes from *outside* this tab/
   * window's own actions (e.g. another Falcon Deck tab saving, or this
   * device's cloud session ending) - never fires for this tab's own
   * writes, so callers don't need to guard against self-triggered loops.
   * Returns an unsubscribe function. A repository with no such mechanism
   * can return a no-op unsubscribe and simply never call back.
   */
  subscribeToExternalChanges(onEvent: (event: ExternalChangeEvent) => void): () => void;
}
