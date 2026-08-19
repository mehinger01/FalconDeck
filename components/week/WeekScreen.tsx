"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { getLocalDateKey } from "@/lib/schedule/localDate";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import { buildWeekPlanningGrid } from "@/lib/week/buildWeekPlanningGrid";
import { getWeekStart } from "@/lib/week/getWeekStart";
import { CopyWeekForwardPanel } from "./CopyWeekForwardPanel";
import { WeekCellActionsModal } from "./WeekCellActionsModal";
import { WeekGrid } from "./WeekGrid";
import { WeekHeader } from "./WeekHeader";

/**
 * The teacher's weekly planning surface: Monday-Friday x class sections,
 * projected fresh from `courses`/`classSections`/`lessons` on every render
 * via `buildWeekPlanningGrid` - there is no separate "week plan" record.
 * Week and course filter both live in the URL (`?date=...&course=...`),
 * matching Lessons and Present Mode Preview's existing pattern.
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

  const filteredSections = courseFilter
    ? data.classSections.filter((section) => section.courseId === courseFilter)
    : data.classSections;

  const grid = buildWeekPlanningGrid({
    weekStart,
    classSections: filteredSections,
    courses: data.courses,
    lessons: data.lessons,
    schedule,
  });

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
        courses={data.courses}
      />

      {data.classSections.length === 0 ? (
        <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-6 text-center text-sm text-falcon-brown-700/60">
          Add class sections in Classes to start planning a week.
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
