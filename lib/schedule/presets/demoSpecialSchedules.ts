import type { BellSchedule, ScheduleBlock } from "@/types/schedule";

/**
 * Demo-only special-day schedules. Their exact times are clearly-marked
 * SAMPLE data, not the official OHHS early-release/testing sequence (which
 * Falcon Deck doesn't have - see OHHS_EARLY_RELEASE_1124 in
 * needsConfigurationSchedules.ts, which stays "Needs Configuration" even
 * in Demo Mode so a demo never implies a guessed time is official). These
 * exist purely so Demo Mode's Early Release / Testing Day scenarios
 * exercise the real calendar -> schedule -> Present Mode chain instead of
 * being a static text card.
 */
export const DEMO_EARLY_RELEASE_ID = "DEMO_EARLY_RELEASE";
export const DEMO_TESTING_DAY_ID = "DEMO_TESTING_DAY";

function block(partial: Omit<ScheduleBlock, "overrides">): ScheduleBlock {
  return { ...partial, overrides: [] };
}

export function createDemoEarlyReleaseSchedule(): BellSchedule {
  return {
    id: DEMO_EARLY_RELEASE_ID,
    name: "Demo Early Release (Sample Times)",
    description: "Sample early-release times for demonstration only - not an official OHHS schedule.",
    isDefault: false,
    timeZone: "America/Detroit",
    source: "built-in",
    blocks: [
      block({ id: `${DEMO_EARLY_RELEASE_ID}-period-1`, label: "Period 1", kind: "instructional", startTime: "07:25", endTime: "08:05", classSectionId: null }),
      block({ id: `${DEMO_EARLY_RELEASE_ID}-passing-1`, label: "Passing", kind: "passing", startTime: "08:05", endTime: "08:09", classSectionId: null }),
      block({ id: `${DEMO_EARLY_RELEASE_ID}-period-2`, label: "Period 2", kind: "instructional", startTime: "08:09", endTime: "08:49", classSectionId: null }),
      block({ id: `${DEMO_EARLY_RELEASE_ID}-passing-2`, label: "Passing", kind: "passing", startTime: "08:49", endTime: "08:53", classSectionId: null }),
      block({ id: `${DEMO_EARLY_RELEASE_ID}-period-3`, label: "Period 3", kind: "enrichment", startTime: "08:53", endTime: "09:13", classSectionId: null }),
      block({ id: `${DEMO_EARLY_RELEASE_ID}-passing-3`, label: "Passing", kind: "passing", startTime: "09:13", endTime: "09:17", classSectionId: null }),
      block({ id: `${DEMO_EARLY_RELEASE_ID}-period-4`, label: "Period 4", kind: "instructional", startTime: "09:17", endTime: "09:57", classSectionId: null }),
      block({
        id: `${DEMO_EARLY_RELEASE_ID}-period-5`,
        label: "Period 5",
        kind: "instructional",
        startTime: "09:57",
        endTime: "10:57",
        classSectionId: null,
        isLunchWindow: true,
      }),
      block({ id: `${DEMO_EARLY_RELEASE_ID}-passing-5`, label: "Passing", kind: "passing", startTime: "10:57", endTime: "11:01", classSectionId: null }),
      block({ id: `${DEMO_EARLY_RELEASE_ID}-period-6`, label: "Period 6", kind: "instructional", startTime: "11:01", endTime: "11:24", classSectionId: null }),
    ],
  };
}

export function createDemoTestingDaySchedule(): BellSchedule {
  return {
    id: DEMO_TESTING_DAY_ID,
    name: "Demo Testing / Assembly Day (Sample Times)",
    description: "Sample testing-day times for demonstration only.",
    isDefault: false,
    timeZone: "America/Detroit",
    source: "built-in",
    blocks: [
      block({ id: `${DEMO_TESTING_DAY_ID}-testing-block`, label: "Testing Block", kind: "custom", customKindLabel: "Testing", startTime: "07:25", endTime: "10:30", classSectionId: null }),
      block({ id: `${DEMO_TESTING_DAY_ID}-passing`, label: "Passing", kind: "passing", startTime: "10:30", endTime: "10:36", classSectionId: null }),
      block({ id: `${DEMO_TESTING_DAY_ID}-period-6`, label: "Period 6", kind: "instructional", startTime: "10:36", endTime: "11:30", classSectionId: null }),
      block({ id: `${DEMO_TESTING_DAY_ID}-passing-2`, label: "Passing", kind: "passing", startTime: "11:30", endTime: "11:36", classSectionId: null }),
      block({ id: `${DEMO_TESTING_DAY_ID}-period-7`, label: "Period 7", kind: "instructional", startTime: "11:36", endTime: "12:30", classSectionId: null }),
    ],
  };
}
