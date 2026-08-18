import type { BellSchedule } from "@/types/schedule";
import type { ClassSection, Course } from "@/types/course";

export interface AppData {
  courses: Course[];
  classSections: ClassSection[];
  schedules: BellSchedule[];
}

/**
 * Abstraction over where Falcon Deck's data lives. Phase 1 ships only
 * `DemoDataRepository` (in-memory seed data, no network/auth required). A
 * future `SupabaseDataRepository` can implement this same interface without
 * any changes to the store or UI that consume it - `load`/`save` are async
 * on purpose, even though the demo implementation resolves instantly.
 */
export interface DataRepository {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
}
