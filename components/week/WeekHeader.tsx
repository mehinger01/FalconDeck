"use client";

import { useRouter } from "next/navigation";
import { addWeeksToDateKey } from "@/lib/week/addWeeksToDateKey";
import { formatWeekRange } from "@/lib/week/formatWeekRange";
import type { Course } from "@/types/course";

/**
 * Week navigation (Previous/This/Next Week + the current range) and the
 * course filter. Every change is a URL navigation
 * (`/week?date=...&course=...`), matching the pattern Lessons and Present
 * Mode Preview already use, so a specific week/filter can be bookmarked or
 * refreshed.
 */
export function WeekHeader({
  weekStart,
  todayWeekStart,
  courseFilter,
  courses,
}: {
  weekStart: string;
  todayWeekStart: string;
  courseFilter: string;
  courses: Course[];
}) {
  const router = useRouter();

  function go(nextWeekStart: string, nextCourseFilter: string) {
    const params = new URLSearchParams({ date: nextWeekStart });
    if (nextCourseFilter) params.set("course", nextCourseFilter);
    router.replace(`/week?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-falcon-brown-900">Week</h1>
        <p className="mt-1 text-sm font-semibold text-falcon-brown-700/80">{formatWeekRange(weekStart)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-falcon-brown-700/30">
          <button
            type="button"
            onClick={() => go(addWeeksToDateKey(weekStart, -1), courseFilter)}
            className="px-3 py-1.5 text-sm font-medium text-falcon-brown-900 hover:bg-falcon-gold-300/30"
          >
            ← Previous Week
          </button>
          <button
            type="button"
            onClick={() => go(todayWeekStart, courseFilter)}
            className="border-x border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/30"
          >
            This Week
          </button>
          <button
            type="button"
            onClick={() => go(addWeeksToDateKey(weekStart, 1), courseFilter)}
            className="px-3 py-1.5 text-sm font-medium text-falcon-brown-900 hover:bg-falcon-gold-300/30"
          >
            Next Week →
          </button>
        </div>

        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Course</span>
          <select
            value={courseFilter}
            onChange={(event) => go(weekStart, event.target.value)}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          >
            <option value="">All Classes</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
