/**
 * Teacher-specific daily-schedule preferences - deliberately separate from
 * BellSchedule (which is school-wide) and from SchoolYearCalendar (which is
 * calendar-wide). Currently just the lunch wave, but this is where any
 * future per-teacher variation belongs, rather than inside a base
 * BellSchedule or a calendar exception.
 */
export type LunchWave = "A" | "B" | "C" | "none";

export interface TeacherSchedulePreferences {
  lunchWave: LunchWave;
}

export const DEFAULT_TEACHER_SCHEDULE_PREFERENCES: TeacherSchedulePreferences = {
  lunchWave: "none",
};

export const LUNCH_WAVE_LABELS: Record<LunchWave, string> = {
  A: "A Lunch",
  B: "B Lunch",
  C: "C Lunch",
  none: "No Lunch / Not Applicable",
};
