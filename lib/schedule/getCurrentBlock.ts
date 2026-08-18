import type { BellSchedule, ResolvedScheduleBlock } from "@/types/schedule";
import { resolveScheduleForWeekday } from "./resolveBlockOverride";
import { getZonedNow, timeStringToSeconds } from "./time";

/**
 * Returns the block active at `now` for today's (weekday-resolved) schedule,
 * or `null` if `now` falls between blocks, before the first block, or after
 * the last block.
 */
export function getCurrentBlock(
  schedule: BellSchedule,
  now: Date = new Date(),
): ResolvedScheduleBlock | null {
  const zoned = getZonedNow(now, schedule.timeZone);
  const blocks = resolveScheduleForWeekday(schedule, zoned.weekday);
  const nowSeconds = zoned.secondsSinceMidnight;

  return (
    blocks.find((block) => {
      const start = timeStringToSeconds(block.startTime);
      const end = timeStringToSeconds(block.endTime);
      return nowSeconds >= start && nowSeconds < end;
    }) ?? null
  );
}
