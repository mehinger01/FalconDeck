import type { BellSchedule, ResolvedScheduleBlock, Weekday } from "@/types/schedule";
import { getScheduleState } from "./getScheduleState";
import { getSecondsUntilStart } from "./getRemainingTime";

export type PresentationState =
  | {
      mode: "instructional";
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
      nextInstructionalBlock: ResolvedScheduleBlock | null;
      secondsUntilNextInstructional: number | null;
    }
  | { mode: "no-blocks-today"; weekday: Weekday };

/**
 * Present Mode's rendering decision, layered on top of getScheduleState.
 *
 * - An active "instructional" block gets the classroom view.
 * - An active "prep" block gets its own private view (never the classroom
 *   view - see PrepView).
 * - Everything else - Lunch, Passing, a non-overridden Enrichment block, a
 *   custom kind, or a literal gap with no active block at all - is treated
 *   as "between instructional periods" and shows the transition countdown
 *   to the next instructional block. Lunch and Prep are never surfaced as
 *   that next instructional class.
 */
export function getPresentationState(
  schedule: BellSchedule,
  now: Date = new Date(),
): PresentationState {
  const state = getScheduleState(schedule, now);

  if (state.status === "no-blocks-today") {
    return { mode: "no-blocks-today", weekday: state.weekday };
  }

  if (state.status === "in-block" && state.block.kind === "instructional") {
    return {
      mode: "instructional",
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
  const nextInstructionalBlock = state.nextInstructionalBlock;
  const secondsUntilNextInstructional = nextInstructionalBlock
    ? getSecondsUntilStart(nextInstructionalBlock, now, schedule.timeZone)
    : null;

  return {
    mode: "transition",
    weekday: state.weekday,
    currentBlock,
    nextInstructionalBlock,
    secondsUntilNextInstructional,
  };
}
