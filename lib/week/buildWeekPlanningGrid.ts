import { resolveScheduleForWeekday } from "@/lib/schedule/resolveBlockOverride";
import { weekdayForDateKey } from "@/lib/schedule/localDate";
import type { ClassSection, Course } from "@/types/course";
import type { DailyLesson } from "@/types/lesson";
import type { BellSchedule } from "@/types/schedule";
import { getLessonPlanningStatus, type LessonPlanningStatus } from "./getLessonPlanningStatus";
import { getWeekDates } from "./getWeekDates";
import { getWeekStart } from "./getWeekStart";

export interface AgendaCompletionSummary {
  completed: number;
  total: number;
}

export interface WeekCell {
  date: string;
  classSectionId: string;
  lesson: DailyLesson | null;
  status: LessonPlanningStatus;
  /** `null` when the lesson has no agenda items - there's nothing to summarize. */
  agendaCompletion: AgendaCompletionSummary | null;
  /**
   * The schedule block (by id) that actually meets this section on this
   * date, if any - e.g. `null` for a section not scheduled that weekday,
   * or for a schedule-less app. Purely informational (de-emphasis, an
   * accurate Preview period label); never blocks planning/editing.
   */
  scheduledBlockId: string | null;
}

export interface WeekRow {
  classSection: ClassSection;
  course: Course | null;
  cells: WeekCell[];
}

export interface WeekPlanningGrid {
  weekStart: string;
  weekDates: string[];
  rows: WeekRow[];
}

function summarizeAgendaCompletion(lesson: DailyLesson | null): AgendaCompletionSummary | null {
  if (!lesson || lesson.agendaItems.length === 0) return null;
  return {
    completed: lesson.agendaItems.filter((item) => item.isCompleted).length,
    total: lesson.agendaItems.length,
  };
}

/** `date -> classSectionId -> blockId`, built once per week instead of per cell. */
function buildScheduledBlockIndex(
  schedule: BellSchedule | null,
  weekDates: string[],
): Map<string, Map<string, string>> {
  const index = new Map<string, Map<string, string>>();
  if (!schedule) return index;

  for (const date of weekDates) {
    const bySection = new Map<string, string>();
    for (const block of resolveScheduleForWeekday(schedule, weekdayForDateKey(date))) {
      if (block.classSectionId && !bySection.has(block.classSectionId)) {
        bySection.set(block.classSectionId, block.id);
      }
    }
    index.set(date, bySection);
  }
  return index;
}

/** `${date}:${classSectionId} -> DailyLesson`, built once per week instead of scanning `lessons` per cell. */
function buildLessonIndex(lessons: DailyLesson[]): Map<string, DailyLesson> {
  const index = new Map<string, DailyLesson>();
  for (const lesson of lessons) {
    index.set(`${lesson.date}:${lesson.classSectionId}`, lesson);
  }
  return index;
}

/**
 * Projects `classSections` + `lessons` (+ optionally the default schedule,
 * for an accurate scheduled/not-scheduled hint) into ready-to-render Week
 * grid data: one row per section, one cell per Monday-Friday date. Both
 * indexes below are built once for the whole week rather than re-scanned
 * per cell, so this is O(rows + cols + lessons) instead of
 * O(rows x cols x lessons).
 */
export function buildWeekPlanningGrid(params: {
  weekStart: string;
  classSections: ClassSection[];
  courses: Course[];
  lessons: DailyLesson[];
  schedule?: BellSchedule | null;
}): WeekPlanningGrid {
  const weekDates = getWeekDates(params.weekStart);
  const lessonIndex = buildLessonIndex(params.lessons);
  const scheduledIndex = buildScheduledBlockIndex(params.schedule ?? null, weekDates);

  const rows: WeekRow[] = params.classSections.map((classSection) => {
    const course = params.courses.find((c) => c.id === classSection.courseId) ?? null;
    const cells: WeekCell[] = weekDates.map((date) => {
      const lesson = lessonIndex.get(`${date}:${classSection.id}`) ?? null;
      return {
        date,
        classSectionId: classSection.id,
        lesson,
        status: getLessonPlanningStatus(lesson),
        agendaCompletion: summarizeAgendaCompletion(lesson),
        scheduledBlockId: scheduledIndex.get(date)?.get(classSection.id) ?? null,
      };
    });
    return { classSection, course, cells };
  });

  return { weekStart: getWeekStart(params.weekStart), weekDates, rows };
}
