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
  /**
   * The SOLE source of truth for which BellSchedule this teacher's Present
   * Mode/Week View should use - see lib/schedule/resolveActiveSchedule.ts.
   * `null` means no explicit selection has been made yet; nothing falls
   * back to a schedule's own `isDefault`, `schedules[0]`, or any other
   * implicit choice - the teacher must explicitly pick one. May point to an
   * organization-owned schedule (referenced, never copied) or one of this
   * teacher's own schedules; Supabase enforces both the same-organization
   * and same-teacher-if-private invariants at the RLS boundary (see
   * supabase/migrations/20260926013603_join_existing_school_stage_d_active_schedule_rls.sql).
   */
  activeBellScheduleId: string | null;
}

export const DEFAULT_TEACHER_SCHEDULE_PREFERENCES: TeacherSchedulePreferences = {
  lunchWave: "none",
  activeBellScheduleId: null,
};

export const LUNCH_WAVE_LABELS: Record<LunchWave, string> = {
  A: "A Lunch",
  B: "B Lunch",
  C: "C Lunch",
  none: "No Lunch / Not Applicable",
};
