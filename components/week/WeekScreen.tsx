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
 * default schedule. This keeps placeholder/demo/old sections out of the live
 * teacher workflow without destructively deleting historical data.
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

  const activeSectionIds = useMemo(() => {
    if (!schedule) return new Set<string>();
    return new Set(
      schedule.blocks
        .filter((block) => block.kind !== "passing" && block.classSectionId)
        .map((block) => block.classSectionId as string),
    );
  }, [schedule]);

  const activeSections = data.classSections.filter((section) => activeSectionIds.has(section.id));
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
