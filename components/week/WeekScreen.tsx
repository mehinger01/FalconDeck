"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { getLocalDateKey } from "@/lib/schedule/localDate";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import { buildWeekPlanningGrid } from "@/lib/week/buildWeekPlanningGrid";
import { getWeekStart } from "@/lib/week/getWeekStart";
import { resolveSchoolDate } from "@/lib/calendar/resolveSchoolDate";
import type { SchoolDateResolution } from "@/types/calendar";
import { CopyWeekForwardPanel } from "./CopyWeekForwardPanel";
import { WeekCellActionsModal } from "./WeekCellActionsModal";
import { WeekGrid } from "./WeekGrid";
import { WeekHeader } from "./WeekHeader";

/**
 * The teacher's weekly planning surface: Monday-Friday x active class sections,
 * projected fresh from `courses`/`classSections`/`lessons` on every render.
 *
 * "Active" means referenced by at least one non-passing block in the current
 * default schedule. Rows are ordered by the earliest assigned block start time
 * so the planning surface mirrors the teacher's actual school day rather than
 * creation/storage order.
 */
export function WeekScreen() {
  const searchParams = useSearchParams();
  const { data } = useAppData();
  const schedule = useDefaultSchedule();
  const timeZone = schedule?.timeZone ?? DEFAULT_TIME_ZONE;

  const todayDateKey = getLocalDateKey(new Date(), timeZone);
  const todayWeekStart = getWeekStart(todayDateKey);

  const weekStart = getWeekStart(searchParams.get("date") ?? todayDateKey);
  const courseFilter = searchParams.get("course") ?? "";

  const sectionStartTimes = useMemo(() => {
    const result = new Map<string, string>();
    if (!schedule) return result;

    for (const block of schedule.blocks) {
      if (block.kind === "passing" || !block.classSectionId) continue;
      const current = result.get(block.classSectionId);
      if (!current || block.startTime < current) {
        result.set(block.classSectionId, block.startTime);
      }
    }

    return result;
  }, [schedule]);

  const activeSectionIds = useMemo(
    () => new Set(sectionStartTimes.keys()),
    [sectionStartTimes],
  );

  const activeSections = useMemo(
    () =>
      data.classSections
        .filter((section) => activeSectionIds.has(section.id))
        .sort((a, b) => {
          const aStart = sectionStartTimes.get(a.id) ?? "99:99";
          const bStart = sectionStartTimes.get(b.id) ?? "99:99";
          const timeCompare = aStart.localeCompare(bStart);
          return timeCompare !== 0 ? timeCompare : a.name.localeCompare(b.name);
        }),
    [data.classSections, activeSectionIds, sectionStartTimes],
  );

  const filteredSections = courseFilter
    ? activeSections.filter((section) => section.courseId === courseFilter)
    : activeSections;

  const activeCourseIds = new Set(activeSections.map((section) => section.courseId));
  const activeCourses = data.courses.filter((course) => activeCourseIds.has(course.id));

  const grid = buildWeekPlanningGrid({
    weekStart,
    classSections: filteredSections,
    courses: data.courses,
    lessons: data.lessons,
    schedule,
  });

  const dayStatuses = new Map<string, SchoolDateResolution>(
    grid.weekDates.map((date) => [
      date,
      resolveSchoolDate({
        dateKey: date,
        calendar: data.schoolCalendar,
        bellSchedules: data.schedules,
        teacherPreferences: data.teacherSchedulePreferences,
      }),
    ]),
  );

  const [selectedCellKey, setSelectedCellKey] = useState<{
    date: string;
    classSectionId: string;
  } | null>(null);

  const selectedRow = selectedCellKey
    ? grid.rows.find((row) => row.classSection.id === selectedCellKey.classSectionId)
    : undefined;
  const selectedCell =
    selectedRow && selectedCellKey
      ? selectedRow.cells.find((cell) => cell.date === selectedCellKey.date)
      : undefined;

  return (
    <div>
      <WeekHeader
        weekStart={weekStart}
        todayWeekStart={todayWeekStart}
        courseFilter={courseFilter}
        courses={activeCourses}
      />

      {activeSections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-6 text-center text-sm text-falcon-brown-700/60">
          No active class sections are assigned to your default schedule yet. Map sections in Schedule Setup to start planning a week.
        </p>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <CopyWeekForwardPanel weekStart={weekStart} classSectionIds={filteredSections.map((s) => s.id)} />
            <p className="text-xs text-falcon-brown-700/60">
              Copies this week&rsquo;s lessons one week forward (same sections, +7 days).
            </p>
          </div>

          <WeekGrid
            grid={grid}
            todayDateKey={todayDateKey}
            dayStatuses={dayStatuses}
            onOpenCell={(date, classSectionId) => setSelectedCellKey({ date, classSectionId })}
          />
        </>
      )}

      {selectedCell && selectedRow && (
        <WeekCellActionsModal
          cell={selectedCell}
          classSection={selectedRow.classSection}
          course={selectedRow.course}
          onClose={() => setSelectedCellKey(null)}
        />
      )}
    </div>
  );
}
