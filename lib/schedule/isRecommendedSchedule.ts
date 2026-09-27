import type { BellSchedule } from "@/types/schedule";

/**
 * "Recommended" means the school admin's designated shared default - it
 * must NEVER be true for a teacher-owned schedule, even one carrying a
 * legacy isDefault:true (a private, non-authoritative bookkeeping flag for
 * teacher-owned rows - see BellSchedule.isDefault's own doc comment).
 * Single source of truth - used by ScheduleList.tsx (the ordinary schedule
 * browser) and ScheduleChoiceScreen.tsx (Stage F onboarding chooser) alike,
 * so this can never drift between the two surfaces that display it.
 */
export function isRecommendedSchedule(schedule: BellSchedule): boolean {
  return schedule.ownerType === "organization" && schedule.isDefault === true;
}
