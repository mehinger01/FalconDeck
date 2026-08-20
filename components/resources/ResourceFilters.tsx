"use client";

import { useState } from "react";
import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import { RESOURCE_TYPES } from "@/types/lesson";
import type { ResourceType } from "@/types/lesson";
import type { Course } from "@/types/course";

/**
 * Search is always front-and-center (Principle 3); course/type filters are
 * progressively disclosed behind a "More filters" toggle (Principle 4) so
 * the common case - typing a few letters - stays uncluttered. Favorites is
 * a single always-visible toggle, matching Part 16's "Favorites first."
 */
export function ResourceFilters({
  query,
  onQueryChange,
  courseId,
  onCourseIdChange,
  type,
  onTypeChange,
  favoritesOnly,
  onFavoritesOnlyChange,
  courses,
  autoFocusSearch = false,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  courseId: string | null;
  onCourseIdChange: (courseId: string | null) => void;
  type: ResourceType | null;
  onTypeChange: (type: ResourceType | null) => void;
  favoritesOnly: boolean;
  onFavoritesOnlyChange: (value: boolean) => void;
  courses: Course[];
  autoFocusSearch?: boolean;
}) {
  const [filtersExpanded, setFiltersExpanded] = useState(Boolean(courseId || type));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search title, tags, notes…"
          autoFocus={autoFocusSearch}
          className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-sm text-falcon-brown-900"
        />
        <button
          type="button"
          onClick={() => onFavoritesOnlyChange(!favoritesOnly)}
          aria-pressed={favoritesOnly}
          className={`shrink-0 rounded-md border px-3 py-2 text-sm font-semibold ${
            favoritesOnly
              ? "border-falcon-gold-500 bg-falcon-gold-400 text-falcon-brown-950"
              : "border-falcon-brown-700/30 text-falcon-brown-800 hover:bg-falcon-gold-300/30"
          }`}
        >
          ★ Favorites
        </button>
        <button
          type="button"
          onClick={() => setFiltersExpanded((current) => !current)}
          aria-expanded={filtersExpanded}
          className="shrink-0 rounded-md border border-falcon-brown-700/30 px-3 py-2 text-sm font-semibold text-falcon-brown-800 hover:bg-falcon-gold-300/30"
        >
          {filtersExpanded ? "Fewer filters" : "More filters"}
        </button>
      </div>

      {filtersExpanded && (
        <div className="flex flex-wrap gap-2">
          <select
            value={courseId ?? ""}
            onChange={(event) => onCourseIdChange(event.target.value || null)}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          >
            <option value="">All Courses</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>

          <select
            value={type ?? ""}
            onChange={(event) => onTypeChange((event.target.value || null) as ResourceType | null)}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          >
            <option value="">All Types</option>
            {RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RESOURCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
