import { findLessonForSection } from "@/lib/data/lessons";
import type { DailyLesson } from "@/types/lesson";
import { addWeeksToDateKey } from "./addWeeksToDateKey";
import { getWeekDates } from "./getWeekDates";
import { getWeekStart } from "./getWeekStart";

export interface WeekForwardCopyItem {
  lessonId: string;
  classSectionId: string;
  sourceDate: string;
  destinationDate: string;
}

export interface WeekForwardConflict extends WeekForwardCopyItem {
  destinationLessonId: string;
}

export interface WeekForwardCopyPlan {
  sourceWeekStart: string;
  destinationWeekStart: string;
  /** Cells with no source lesson are simply absent here - there's nothing to copy. */
  toCopy: WeekForwardCopyItem[];
  /** Source cells whose destination (source date + 7 days) already has a lesson. */
  conflicts: WeekForwardConflict[];
}

/**
 * Read-only: figures out exactly what "Copy Week Forward" would do for
 * `classSectionIds` over the Monday-Friday week containing `weekStart` -
 * every prepared/draft lesson, one week later (source date + 7 calendar
 * days) - and splits it into clean copies vs. destination conflicts,
 * before anything is written. The UI shows this plan as a summary and
 * gets explicit confirmation; nothing is mutated until `copyWeekForward`
 * (below) is actually called.
 */
export function planCopyWeekForward(params: {
  weekStart: string;
  classSectionIds: string[];
  lessons: DailyLesson[];
}): WeekForwardCopyPlan {
  const sourceWeekStart = getWeekStart(params.weekStart);
  const destinationWeekStart = addWeeksToDateKey(sourceWeekStart, 1);
  const sourceDates = getWeekDates(sourceWeekStart);
  const destinationDates = getWeekDates(destinationWeekStart);

  const toCopy: WeekForwardCopyItem[] = [];
  const conflicts: WeekForwardConflict[] = [];

  for (const classSectionId of params.classSectionIds) {
    sourceDates.forEach((sourceDate, index) => {
      const sourceLesson = findLessonForSection(params.lessons, sourceDate, classSectionId);
      if (!sourceLesson) return; // nothing prepared in this cell - nothing to copy

      const destinationDate = destinationDates[index];
      const item: WeekForwardCopyItem = {
        lessonId: sourceLesson.id,
        classSectionId,
        sourceDate,
        destinationDate,
      };

      const destinationLesson = findLessonForSection(params.lessons, destinationDate, classSectionId);
      if (destinationLesson) {
        conflicts.push({ ...item, destinationLessonId: destinationLesson.id });
      } else {
        toCopy.push(item);
      }
    });
  }

  return { sourceWeekStart, destinationWeekStart, toCopy, conflicts };
}

export type CopyWeekForwardMode = "non-conflicting-only" | "replace-conflicts";

export interface CopyWeekForwardResult {
  copied: number;
  skipped: number;
}

type CopyLessonToSection = (
  lessonId: string,
  destinationClassSectionId: string,
  destinationDate: string,
  options?: { overwrite?: boolean },
) => "copied" | "conflict";

/**
 * Executes a plan already produced by `planCopyWeekForward`. Every actual
 * write goes through the caller's `copyLessonToSection` - the exact same
 * store action Copy-to-Tomorrow and Copy-to-Another-Period already use -
 * so there is exactly one place deep-copy-with-fresh-ids happens; this
 * function only decides *which* items to write and whether to overwrite.
 *
 * "non-conflicting-only": copies `plan.toCopy`, leaves every conflict
 * untouched.
 * "replace-conflicts": copies `plan.toCopy` AND overwrites every conflict
 * (only reachable after the teacher has explicitly chosen this mode).
 */
export function copyWeekForward(
  plan: WeekForwardCopyPlan,
  mode: CopyWeekForwardMode,
  copyLessonToSection: CopyLessonToSection,
): CopyWeekForwardResult {
  let copied = 0;
  let skipped = 0;

  for (const item of plan.toCopy) {
    const result = copyLessonToSection(item.lessonId, item.classSectionId, item.destinationDate);
    if (result === "copied") copied += 1;
    else skipped += 1;
  }

  if (mode === "replace-conflicts") {
    for (const item of plan.conflicts) {
      const result = copyLessonToSection(item.lessonId, item.classSectionId, item.destinationDate, {
        overwrite: true,
      });
      if (result === "copied") copied += 1;
      else skipped += 1;
    }
  } else {
    skipped += plan.conflicts.length;
  }

  return { copied, skipped };
}
