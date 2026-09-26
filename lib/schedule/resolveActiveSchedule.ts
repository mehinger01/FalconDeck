import type { BellSchedule } from "@/types/schedule";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";

/**
 * The SOLE resolver for "which BellSchedule is this teacher's active
 * schedule" - `teacherSchedulePreferences.activeBellScheduleId` is the only
 * input consulted. Deliberately no fallback to `isDefault`, `schedules[0]`,
 * an organization's `is_default` schedule, or any local/legacy
 * default-schedule mechanism (e.g. localStorageRepository's old
 * saveDefaultScheduleSelection key) - a null `activeBellScheduleId` means
 * "no explicit selection has been made yet," and this returns `null` for
 * that case rather than guessing. Explicit over implicit, per the Stage D
 * architecture review (join-existing-school initiative): every caller that
 * needs "the active schedule" must go through this one function, so there
 * is exactly one place the rule can ever be stated.
 *
 * `schedules` may contain both organization-owned and teacher-owned rows
 * (Falcon Deck's Supabase read path already merges both, unconditionally -
 * see lib/data/supabaseDataRepository.ts) - this function does not care
 * which kind it finds; ownership only matters for the write/selection UI
 * (see components/schedule/ScheduleList.tsx), never for resolving which one
 * is currently active.
 */
export function resolveActiveSchedule(
  schedules: BellSchedule[],
  teacherSchedulePreferences: TeacherSchedulePreferences,
): BellSchedule | null {
  const { activeBellScheduleId } = teacherSchedulePreferences;
  if (activeBellScheduleId === null) return null;
  return schedules.find((schedule) => schedule.id === activeBellScheduleId) ?? null;
}
