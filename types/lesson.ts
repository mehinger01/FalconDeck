/**
 * Daily lesson models.
 *
 * A DailyLesson belongs to exactly one school-local date ("YYYY-MM-DD", see
 * `getLocalDateKey`) and one ClassSection. There is at most one DailyLesson
 * per (date, classSectionId) pair - see `findLessonForSection` in
 * `lib/data/lessons.ts`, the single place that lookup happens.
 *
 * Agenda items intentionally have no duration/timing fields yet (Phase 2
 * scope) - just title, optional details, completion, and manual order.
 */

export const RESOURCE_TYPES = [
  "link",
  "document",
  "slides",
  "video",
  "desmos",
  "calculator",
  "pdf",
  "image",
  "spreadsheet",
  "other",
] as const;

/** Shared by lesson resources and Resource Library resources - one type system, not two. */
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export interface AgendaItem {
  id: string;
  title: string;
  details?: string;
  isCompleted: boolean;
  /** Manual display order within the lesson, ascending. */
  sortOrder: number;
}

export interface LessonResource {
  id: string;
  title: string;
  url: string;
  type: ResourceType;
  /**
   * The LibraryResource this was attached from, if any - for traceability
   * only. A lesson resource is always a standalone copy (title/url/type),
   * so it keeps working exactly as-is even if the library resource is
   * later edited or deleted; nothing ever re-reads the library at render
   * time. See `lib/data/libraryResources.ts`.
   */
  libraryResourceId?: string;
}

export interface Announcement {
  id: string;
  text: string;
}

export interface DailyLesson {
  id: string;
  /** School-local date, "YYYY-MM-DD" - see `getLocalDateKey`. */
  date: string;
  classSectionId: string;
  learningTarget: string;
  agendaItems: AgendaItem[];
  resources: LessonResource[];
  announcements: Announcement[];
  /**
   * Free-text prep/materials list (e.g. "Student Edition pp. 11-12; guided
   * notes; calculator"). Teacher-facing only - intentionally not shown in
   * Present Mode alongside the four student-facing panels. `undefined` for
   * any lesson created before this field existed or with nothing entered.
   */
  materials?: string;
  /** ISO 8601 timestamps, informational only. */
  createdAt: string;
  updatedAt: string;
}
