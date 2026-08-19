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
  "other",
] as const;

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
  /** ISO 8601 timestamps, informational only. */
  createdAt: string;
  updatedAt: string;
}
