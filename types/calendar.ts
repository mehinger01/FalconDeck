import type { BellSchedule } from "./schedule";

/**
 * The Master Calendar: what kind of school day a given date is, and which
 * BellSchedule (if any) applies. Deliberately an "exception overlay" - most
 * dates within the school year are implicitly regular days using
 * `defaultBellScheduleId`; only exceptions to that (no school, no students,
 * a special bell schedule) get their own record. This is what keeps a
 * whole school year from requiring hundreds of normal-day rows.
 */
export type SchoolDayExceptionType = "no-school" | "no-students" | "special-bell";

export interface SchoolCalendarException {
  id: string;
  /** "YYYY-MM-DD", inclusive. */
  startDate: string;
  /** "YYYY-MM-DD", inclusive - equal to startDate for a single day. */
  endDate: string;
  type: SchoolDayExceptionType;
  title: string;
  /** Only meaningful for "special-bell" - the real BellSchedule to use, once resolved/mapped. */
  bellScheduleId?: string;
  /** The raw profile key from an import (e.g. "OHHS_EARLY_RELEASE_1124"), kept even after mapping for traceability/re-import diffing. */
  sourceScheduleProfile?: string;
  /** Human-readable dismissal time, e.g. "11:24 AM" - metadata only; the actual bell times live on the mapped BellSchedule once configured. */
  dismissalTime?: string;
  notes?: string;
}

export interface SchoolYearCalendar {
  id: string;
  name: string;
  schoolYear: string;
  timeZone: string;
  /** "YYYY-MM-DD" */
  firstStudentDay: string;
  /** "YYYY-MM-DD" */
  lastStudentDay: string;
  defaultBellScheduleId: string;
  exceptions: SchoolCalendarException[];
}

export type SchoolDateStatus =
  | "regular"
  | "special-schedule"
  | "no-school"
  | "no-students"
  | "unconfigured-schedule"
  | "weekend"
  | "outside-school-year";

/**
 * The authoritative "what does this date mean" answer, returned by
 * lib/calendar/resolveSchoolDate.ts - the layer that runs before the
 * existing schedule engine (getPresentationState et al.). `bellSchedule` is
 * the raw, unmodified school-wide schedule; `resolvedTeacherSchedule` is
 * the same schedule after a teacher's lunch-wave preference has been
 * applied (see resolveTeacherSchedule) - only present when a usable
 * schedule was actually found.
 */
export interface SchoolDateResolution {
  dateKey: string;
  status: SchoolDateStatus;
  bellSchedule: BellSchedule | null;
  resolvedTeacherSchedule?: BellSchedule;
  title?: string;
  exception?: SchoolCalendarException;
}
