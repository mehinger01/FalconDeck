import type { BellSchedule } from "@/types/schedule";

/**
 * An organization-owned schedule a teacher can actually select as their
 * active schedule (or view/edit assignments for) - has real block times
 * configured, unlike a still-"Needs Configuration" placeholder with no
 * blocks yet. Single source of truth for this predicate - used by
 * ScheduleSetupScreen (deciding whether to show SharedScheduleAssignmentView
 * instead of the plain read-only summary) and ScheduleChoiceScreen (Stage F
 * onboarding - which shared schedules to offer as a choice at all).
 */
export function isUsableSharedSchedule(schedule: BellSchedule): boolean {
  return schedule.ownerType === "organization" && !schedule.needsConfiguration && schedule.blocks.length > 0;
}
