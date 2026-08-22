"use client";

import { weekdayForDateKey } from "@/lib/schedule/localDate";
import { formatShortDate } from "@/lib/week/formatWeekRange";
import type { WeekPlanningGrid } from "@/lib/week/buildWeekPlanningGrid";
import type { SchoolDateResolution } from "@/types/calendar";
import { WeekCell } from "./WeekCell";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
};

function dayBadge(resolution: SchoolDateResolution | undefined): string | null {
  if (!resolution) return null;
  if (resolution.status === "no-school") return "NO SCHOOL";
  if (resolution.status === "no-students") return "NO STUDENTS";
  if (resolution.status === "unconfigured-schedule") return "NEEDS SETUP";
  if (resolution.status === "special-schedule") return (resolution.title ?? "SPECIAL SCHEDULE").toUpperCase();
  return null;
}

/**
 * The Monday-Friday x class-section grid itself. Purely presentational -
 * all planning-status logic already happened in `buildWeekPlanningGrid`,
 * and all calendar-status logic already happened in `resolveSchoolDate`
 * (called once per weekday in WeekScreen, passed in as `dayStatuses`) -
 * this component only renders both and reports clicks back up via
 * `onOpenCell`. Horizontally scrollable with a pinned section-name column,
 * so it stays usable on a narrower laptop screen without shrinking text
 * past readability.
 */
export function WeekGrid({
  grid,
  todayDateKey,
  dayStatuses,
  onOpenCell,
}: {
  grid: WeekPlanningGrid;
  todayDateKey: string;
  dayStatuses?: Map<string, SchoolDateResolution>;
  onOpenCell: (date: string, classSectionId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-falcon-brown-700/15 bg-white/40 p-2">
      <table className="w-full min-w-[52rem] border-separate border-spacing-2">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[10rem] bg-falcon-cream-200 px-2 py-1 text-left text-xs font-bold uppercase tracking-wide text-falcon-brown-700/70">
              Class Section
            </th>
            {grid.weekDates.map((date) => {
              const isToday = date === todayDateKey;
              const resolution = dayStatuses?.get(date);
              const isNoSchoolDay = resolution?.status === "no-school";
              const badge = dayBadge(resolution);
              return (
                <th
                  key={date}
                  className={`min-w-[9rem] rounded-lg px-2 py-1.5 text-xs font-bold uppercase tracking-wide ${
                    isToday
                      ? "bg-falcon-gold-400 text-falcon-brown-950"
                      : isNoSchoolDay
                        ? "bg-falcon-cream-300/50 text-falcon-brown-700/40"
                        : "bg-falcon-cream-300 text-falcon-brown-700/80"
                  }`}
                >
                  <div>
                    {WEEKDAY_LABELS[weekdayForDateKey(date)]}
                    <span className="ml-1.5 font-medium normal-case">{formatShortDate(date)}</span>
                  </div>
                  {badge && (
                    <span
                      className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-wide ${
                        isNoSchoolDay
                          ? "bg-falcon-brown-700/10 text-falcon-brown-700/60"
                          : "bg-falcon-gold-500/70 text-falcon-brown-950"
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <tr key={row.classSection.id}>
              <th
                scope="row"
                className="sticky left-0 z-10 min-w-[10rem] rounded-lg bg-falcon-cream-200 px-2 py-2 text-left align-top"
              >
                <p className="text-sm font-semibold text-falcon-brown-900">{row.classSection.name}</p>
                {row.course && <p className="text-xs text-falcon-brown-700/60">{row.course.name}</p>}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.date} className="align-top">
                  <WeekCell
                    cell={cell}
                    isToday={cell.date === todayDateKey}
                    isNoSchoolDay={dayStatuses?.get(cell.date)?.status === "no-school"}
                    onOpen={() => onOpenCell(cell.date, cell.classSectionId)}
                  />
                </td>
              ))}
            </tr>
          ))}
          {grid.rows.length === 0 && (
            <tr>
              <td colSpan={grid.weekDates.length + 1} className="px-3 py-6 text-center text-sm text-falcon-brown-700/60">
                No class sections match this filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
