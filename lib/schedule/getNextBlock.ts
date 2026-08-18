import type { BellSchedule, ResolvedScheduleBlock } from "@/types/schedule";
import { resolveScheduleForWeekday } from "./resolveBlockOverride";
import { getZonedNow, timeStringToSeconds } from "./time";

/**
 * Returns the block immediately following `now` today (of any kind), or
 * `null` if there is no later block.
 */
export function getNextBlock(
  schedule: BellSchedule,
  now: Date = new Date(),
): ResolvedScheduleBlock | null {
  const zoned = getZonedNow(now, schedule.timeZone);
  const blocks = resolveScheduleForWeekday(schedule, zoned.weekday);
  const nowSeconds = zoned.secondsSinceMidnight;

  const upcoming = blocks
    .filter((block) => timeStringToSeconds(block.startTime) > nowSeconds)
    .sort(
      (a, b) => timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime),
    );

  return upcoming[0] ?? null;
}

/**
 * Returns the next block strictly after `now` today whose kind is
 * "instructional" - i.e. the next student-facing class. Lunch, Prep,
 * Passing, and Enrichment (unless a weekday override promotes it to
 * "instructional", as with a Thursday SAT Prep override) are skipped.
 */
export function getNextInstructionalBlock(
  schedule: BellSchedule,
  now: Date = new Date(),
): ResolvedScheduleBlock | null {
  const zoned = getZonedNow(now, schedule.timeZone);
  const blocks = resolveScheduleForWeekday(schedule, zoned.weekday);
  const nowSeconds = zoned.secondsSinceMidnight;

  const upcoming = blocks
    .filter(
      (block) =>
        block.kind === "instructional" &&
        timeStringToSeconds(block.startTime) > nowSeconds,
    )
    .sort(
      (a, b) => timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime),
    );

  return upcoming[0] ?? null;
}

/**
 * Returns the most recently completed block as of `now` today, or `null`
 * if `now` is before the first block starts.
 */
export function getPreviousBlock(
  schedule: BellSchedule,
  now: Date = new Date(),
): ResolvedScheduleBlock | null {
  const zoned = getZonedNow(now, schedule.timeZone);
  const blocks = resolveScheduleForWeekday(schedule, zoned.weekday);
  const nowSeconds = zoned.secondsSinceMidnight;

  const completed = blocks
    .filter((block) => timeStringToSeconds(block.endTime) <= nowSeconds)
    .sort(
      (a, b) => timeStringToSeconds(b.endTime) - timeStringToSeconds(a.endTime),
    );

  return completed[0] ?? null;
}
