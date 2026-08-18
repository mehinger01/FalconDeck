import type { BellSchedule } from "@/types/schedule";
import { WEEKDAYS } from "@/types/schedule";
import { resolveScheduleForWeekday } from "./resolveBlockOverride";
import { timeStringToSeconds } from "./time";

export interface ScheduleValidationIssue {
  blockId: string;
  weekday: (typeof WEEKDAYS)[number];
  message: string;
}

/**
 * Checks a schedule for time-ordering problems (a block ending before it
 * starts, or two blocks overlapping) across every weekday, including any
 * effect weekday overrides have on start/end times. Used by the Schedule
 * Setup UI to surface warnings - it does not block saving.
 */
export function validateSchedule(schedule: BellSchedule): ScheduleValidationIssue[] {
  const issues: ScheduleValidationIssue[] = [];

  for (const weekday of WEEKDAYS) {
    const blocks = [...resolveScheduleForWeekday(schedule, weekday)].sort(
      (a, b) => timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime),
    );

    blocks.forEach((block, index) => {
      const start = timeStringToSeconds(block.startTime);
      const end = timeStringToSeconds(block.endTime);

      if (end <= start) {
        issues.push({
          blockId: block.blockId,
          weekday,
          message: `"${block.label}" ends at or before it starts on ${weekday}.`,
        });
      }

      const next = blocks[index + 1];
      if (next && end > timeStringToSeconds(next.startTime)) {
        issues.push({
          blockId: block.blockId,
          weekday,
          message: `"${block.label}" overlaps with "${next.label}" on ${weekday}.`,
        });
      }
    });
  }

  return issues;
}
