import type { BellSchedule, ScheduleBlock } from "@/types/schedule";

/**
 * Ogemaw Heights High School's actual current regular-day bell schedule -
 * not fictional demo data. `id` doubles as the stable profile key the
 * Master Calendar importer maps `REGULAR` to automatically (Part 6).
 *
 * The 7:20 AM First Bell is informational, not a class - represented as a
 * `kind: "custom"` block (never student-facing) rather than inventing a new
 * BlockKind. Period 3 is intentionally only 20 minutes (9:29-9:49) - this
 * is OHHS's Enrichment block, `kind: "enrichment"`, so it stays
 * student-facing without any weekday-specific logic. Period 5
 * (10:48-12:18) is the school-wide lunch window (`isLunchWindow: true`);
 * the school-wide schedule itself contains no A/B/C split at all - that's
 * applied per-teacher by resolveTeacherSchedule.ts, never baked in here.
 */
export const OHHS_REGULAR_ID = "OHHS_REGULAR";

function block(partial: Omit<ScheduleBlock, "overrides">): ScheduleBlock {
  return { ...partial, overrides: [] };
}

export function createOhhsRegularSchedule(): BellSchedule {
  return {
    id: OHHS_REGULAR_ID,
    name: "OHHS Regular Day",
    description: "Ogemaw Heights High School's standard bell schedule.",
    isDefault: false,
    timeZone: "America/Detroit",
    source: "built-in",
    blocks: [
      block({
        id: `${OHHS_REGULAR_ID}-first-bell`,
        label: "First Bell",
        kind: "custom",
        customKindLabel: "First Bell",
        startTime: "07:20",
        endTime: "07:25",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-period-1`,
        label: "Period 1",
        kind: "instructional",
        startTime: "07:25",
        endTime: "08:23",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-passing-1`,
        label: "Passing",
        kind: "passing",
        startTime: "08:23",
        endTime: "08:29",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-period-2`,
        label: "Period 2",
        kind: "instructional",
        startTime: "08:29",
        endTime: "09:23",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-passing-2`,
        label: "Passing",
        kind: "passing",
        startTime: "09:23",
        endTime: "09:29",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-period-3`,
        label: "Period 3",
        kind: "enrichment",
        startTime: "09:29",
        endTime: "09:49",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-passing-3`,
        label: "Passing",
        kind: "passing",
        startTime: "09:49",
        endTime: "09:55",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-period-4`,
        label: "Period 4",
        kind: "instructional",
        startTime: "09:55",
        endTime: "10:48",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-period-5`,
        label: "Period 5",
        kind: "instructional",
        startTime: "10:48",
        endTime: "12:18",
        classSectionId: null,
        isLunchWindow: true,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-passing-5`,
        label: "Passing",
        kind: "passing",
        startTime: "12:18",
        endTime: "12:24",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-period-6`,
        label: "Period 6",
        kind: "instructional",
        startTime: "12:24",
        endTime: "13:18",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-passing-6`,
        label: "Passing",
        kind: "passing",
        startTime: "13:18",
        endTime: "13:24",
        classSectionId: null,
      }),
      block({
        id: `${OHHS_REGULAR_ID}-period-7`,
        label: "Period 7",
        kind: "instructional",
        startTime: "13:24",
        endTime: "14:19",
        classSectionId: null,
      }),
    ],
  };
}
