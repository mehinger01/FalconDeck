import type { ResolvedScheduleBlock } from "@/types/schedule";
import { getZonedNow, timeStringToSeconds } from "./time";

/**
 * Seconds remaining before the end-of-class countdown should appear.
 * Below or at this threshold the countdown is shown; above it, it stays
 * hidden. Works uniformly for blocks of any length, including a 20-minute
 * Enrichment block - the rule only ever looks at time remaining, never
 * block duration.
 */
export const COUNTDOWN_THRESHOLD_SECONDS = 5 * 60;

/** Seconds remaining in `block` as of `now`, clamped to zero. */
export function getRemainingSeconds(
  block: ResolvedScheduleBlock,
  now: Date,
  timeZone: string,
): number {
  const zoned = getZonedNow(now, timeZone);
  const end = timeStringToSeconds(block.endTime);
  return Math.max(0, end - zoned.secondsSinceMidnight);
}

/** Total scheduled duration of `block`, in seconds. */
export function getBlockDurationSeconds(block: ResolvedScheduleBlock): number {
  return Math.max(
    0,
    timeStringToSeconds(block.endTime) - timeStringToSeconds(block.startTime),
  );
}

/** Seconds from `now` until `block` starts (may be negative if it already started). */
export function getSecondsUntilStart(
  block: ResolvedScheduleBlock,
  now: Date,
  timeZone: string,
): number {
  const zoned = getZonedNow(now, timeZone);
  return timeStringToSeconds(block.startTime) - zoned.secondsSinceMidnight;
}

/**
 * True from the instant exactly 5:00 remain through the end of the block.
 * At more than 5:00 remaining, no end-of-class countdown should be shown.
 */
export function shouldShowCountdown(remainingSeconds: number): boolean {
  return remainingSeconds <= COUNTDOWN_THRESHOLD_SECONDS && remainingSeconds >= 0;
}
