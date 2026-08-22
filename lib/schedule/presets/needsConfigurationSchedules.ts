import type { BellSchedule } from "@/types/schedule";

/**
 * Placeholder BellSchedules for profiles the Master Calendar references by
 * name but whose actual period times aren't known yet (Part 6's "Special
 * Profile Rule": never fabricate bell times from a dismissal time alone).
 * `blocks` stays empty - `needsConfiguration: true` is what tells
 * resolveSchoolDate.ts and the Present Mode UI to show "Schedule Setup
 * Needed" instead of guessing.
 */
function needsConfigurationSchedule(id: string, name: string, description: string): BellSchedule {
  return {
    id,
    name,
    description,
    isDefault: false,
    timeZone: "America/Detroit",
    source: "built-in",
    needsConfiguration: true,
    blocks: [],
  };
}

export const OHHS_EARLY_RELEASE_1124_ID = "OHHS_EARLY_RELEASE_1124";
export const OHHS_LAST_DAY_HALF_DAY_ID = "OHHS_LAST_DAY_HALF_DAY";

export function createOhhsEarlyRelease1124Schedule(): BellSchedule {
  return needsConfigurationSchedule(
    OHHS_EARLY_RELEASE_1124_ID,
    "OHHS Early Release (11:24 Dismissal)",
    "Referenced by the OHHS 2026-27 Master Calendar with an 11:24 AM dismissal time - the actual period sequence has not been supplied yet.",
  );
}

export function createOhhsLastDayHalfDaySchedule(): BellSchedule {
  return needsConfigurationSchedule(
    OHHS_LAST_DAY_HALF_DAY_ID,
    "OHHS Last Student Day / Half Day",
    "Referenced by the OHHS 2026-27 Master Calendar for the last student day - the actual period sequence has not been supplied yet.",
  );
}
