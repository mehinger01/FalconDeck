"use client";

import { weekdayForDateKey } from "@/lib/schedule/localDate";
import { formatShortDate } from "@/lib/week/formatWeekRange";
import type { WeekPlanningGrid } from "@/lib/week/buildWeekPlanningGrid";
import { WeekCell } from "./WeekCell";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
};

/**
 * The Monday-Friday x class-section grid itself. Purely presentational -
 * all planning-status logic already happened in `buildWeekPlanningGrid`,
 * so this component only renders `grid` and reports clicks back up via
 * `onOpenCell`. Horizontally scrollable with a pinned section-name column,
 * so it stays usable on a narrower laptop screen without shrinking text
 * past readability.
 */
export function WeekGrid({
  grid,
  todayDateKey,
  onOpenCell,
}: {
  grid: WeekPlanningGrid;
  todayDateKey: string;
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
              return (
                <th
                  key={date}
                  className={`min-w-[9rem] rounded-lg px-2 py-1.5 text-xs font-bold uppercase tracking-wide ${
                    isToday
                      ? "bg-falcon-gold-400 text-falcon-brown-950"
                      : "bg-falcon-cream-300 text-falcon-brown-700/80"
                  }`}
                >
                  {WEEKDAY_LABELS[weekdayForDateKey(date)]}
                  <span className="ml-1.5 font-medium normal-case">{formatShortDate(date)}</span>
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
