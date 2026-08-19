import type { BellSchedule, ResolvedScheduleBlock, Weekday } from "@/types/schedule";
import { getScheduleState } from "./getScheduleState";
import { getSecondsUntilStart } from "./getRemainingTime";
import { isStudentFacingBlock } from "./isStudentFacingBlock";

export type PresentationState =
  | {
      mode: "student-facing";
      weekday: Weekday;
      block: ResolvedScheduleBlock;
      remainingSeconds: number;
      totalSeconds: number;
      showCountdown: boolean;
    }
  | {
      mode: "prep";
      weekday: Weekday;
      block: ResolvedScheduleBlock;
      remainingSeconds: number;
      totalSeconds: number;
    }
  | {
      mode: "transition";
      weekday: Weekday;
      currentBlock: ResolvedScheduleBlock | null;
      nextStudentFacingBlock: ResolvedScheduleBlock | null;
      secondsUntilNextStudentFacing: number | null;
    }
  | { mode: "no-blocks-today"; weekday: Weekday };

/**
 * Present Mode's rendering decision, layered on top of getScheduleState.
 *
 * - An active student-facing block (see `isStudentFacingBlock` -
 *   "instructional" or "enrichment", regardless of weekday overrides) gets
 *   the classroom view.
 * - An active "prep" block gets its own private view (never the classroom
 *   view - see PrepView).
 * - Everything else - Lunch, Passing, a custom kind, or a literal gap with
 *   no active block at all - is treated as "between student-facing
 *   periods" and shows the transition countdown to the next student-facing
 *   block. Lunch and Prep are never surfaced as that next block.
 */
export function getPresentationState(
  schedule: BellSchedule,
  now: Date = new Date(),
): PresentationState {
  const state = getScheduleState(schedule, now);

  if (state.status === "no-blocks-today") {
    return { mode: "no-blocks-today", weekday: state.weekday };
  }

  if (state.status === "in-block" && isStudentFacingBlock(state.block)) {
    return {
      mode: "student-facing",
      weekday: state.weekday,
      block: state.block,
      remainingSeconds: state.remainingSeconds,
      totalSeconds: state.totalSeconds,
      showCountdown: state.showCountdown,
    };
  }

  if (state.status === "in-block" && state.block.kind === "prep") {
    return {
      mode: "prep",
      weekday: state.weekday,
      block: state.block,
      remainingSeconds: state.remainingSeconds,
      totalSeconds: state.totalSeconds,
    };
  }

  const currentBlock = state.status === "in-block" ? state.block : null;
  const nextStudentFacingBlock = state.nextStudentFacingBlock;
  const secondsUntilNextStudentFacing = nextStudentFacingBlock
    ? getSecondsUntilStart(nextStudentFacingBlock, now, schedule.timeZone)
    : null;

  return {
    mode: "transition",
    weekday: state.weekday,
    currentBlock,
    nextStudentFacingBlock,
    secondsUntilNextStudentFacing,
  };
}
