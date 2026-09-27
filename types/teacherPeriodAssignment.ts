import type { Weekday } from "./schedule";

/**
 * A teacher's own binding of one of their class sections onto a block that
 * belongs to a schedule they don't own (an organization-owned/shared
 * BellSchedule - see BellSchedule.ownerType). This is what lets a shared
 * Master Schedule's blocks show each teacher's own classes without ever
 * mutating the shared schedule itself.
 *
 * Stage E only ever creates/updates BASE assignments (`overrideWeekday:
 * null`). A non-null `overrideWeekday` marks a weekday-specific
 * reassignment - Stage E's own UI never creates, edits, or deletes one, but
 * an existing weekday-specific row must never be silently dropped either;
 * it simply passes through this array unchanged (see
 * lib/store/reducer.ts's SET_TEACHER_PERIOD_ASSIGNMENT case).
 *
 * Unlike ScheduleBlockOverride.classSectionId (a genuine tri-state:
 * undefined/null/string), `classSectionId` here is never null -
 * teacher_period_assignments.class_section_id is NOT NULL at the database
 * level. "No assignment for this block" is represented by this row's
 * absence from the array, never by an explicit null value.
 */
export interface TeacherPeriodAssignment {
  /** A real RFC-compatible UUID (teacher_period_assignments.id is `uuid`) - see lib/store/id.ts's generateId(), which is NOT used here because it produces a prefixed, non-UUID string. */
  id: string;
  /** The owning BellSchedule's id. */
  scheduleId: string;
  /** The ScheduleBlock's id - unique only within `scheduleId`, per ScheduleBlock.id's own convention. */
  blockId: string;
  overrideWeekday: Weekday | null;
  classSectionId: string;
}
