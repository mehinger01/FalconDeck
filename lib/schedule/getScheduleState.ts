import type { BellSchedule, ResolvedScheduleBlock, Weekday } from "@/types/schedule";
import { getCurrentBlock } from "./getCurrentBlock";
import { getNextBlock, getNextStudentFacingBlock, getPreviousBlock } from "./getNextBlock";
import {
  getBlockDurationSeconds,
  getRemainingSeconds,
  getSecondsUntilStart,
  shouldShowCountdown,
} from "./getRemainingTime";
import { resolveScheduleForWeekday } from "./resolveBlockOverride";
import { getZonedNow } from "./time";

export type ScheduleState =
  | {
      status: "in-block";
      weekday: Weekday;
      block: ResolvedScheduleBlock;
      remainingSeconds: number;
      totalSeconds: number;
      showCountdown: boolean;
      nextStudentFacingBlock: ResolvedScheduleBlock | null;
    }
  | {
      status: "between-blocks";
      weekday: Weekday;
      previousBlock: ResolvedScheduleBlock | null;
      nextBlock: ResolvedScheduleBlock | null;
      nextStudentFacingBlock: ResolvedScheduleBlock | null;
      secondsUntilNextStudentFacing: number | null;
    }
  | {
      status: "no-blocks-today";
      weekday: Weekday;
    };

/**
 * Composes the individual pure engine functions into the single state
 * object the Present Mode UI needs each tick. This is the only function UI
 * components should call to figure out "what should be on screen right
 * now" - it contains no rendering or timing (interval) concerns itself.
 */
export function getScheduleState(
  schedule: BellSchedule,
  now: Date = new Date(),
): ScheduleState {
  const zoned = getZonedNow(now, schedule.timeZone);
  const blocksToday = resolveScheduleForWeekday(schedule, zoned.weekday);

  if (blocksToday.length === 0) {
    return { status: "no-blocks-today", weekday: zoned.weekday };
  }

  const currentBlock = getCurrentBlock(schedule, now);
  if (currentBlock) {
    const remainingSeconds = getRemainingSeconds(currentBlock, now, schedule.timeZone);
    return {
      status: "in-block",
      weekday: zoned.weekday,
      block: currentBlock,
      remainingSeconds,
      totalSeconds: getBlockDurationSeconds(currentBlock),
      showCountdown: shouldShowCountdown(remainingSeconds),
      nextStudentFacingBlock: getNextStudentFacingBlock(schedule, now),
    };
  }

  const nextStudentFacingBlock = getNextStudentFacingBlock(schedule, now);
  const secondsUntilNextStudentFacing = nextStudentFacingBlock
    ? getSecondsUntilStart(nextStudentFacingBlock, now, schedule.timeZone)
    : null;

  return {
    status: "between-blocks",
    weekday: zoned.weekday,
    previousBlock: getPreviousBlock(schedule, now),
    nextBlock: getNextBlock(schedule, now),
    nextStudentFacingBlock,
    secondsUntilNextStudentFacing,
  };
}
