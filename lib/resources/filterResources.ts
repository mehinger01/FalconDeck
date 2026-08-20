import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import type { Course } from "@/types/course";
import type { ResourceType } from "@/types/lesson";
import type { LibraryResource } from "@/types/resource";

export interface ResourceFilters {
  /** `null`/`undefined` = all courses. */
  courseId?: string | null;
  /** `null`/`undefined` = all types. */
  type?: ResourceType | null;
  favoritesOnly?: boolean;
}

/**
 * Fast client-side search + filter over the Resource Library - the only
 * place this logic lives (Part 3), so it's never reimplemented per-screen
 * (the main /resources list and the lesson-attachment picker both call
 * this). Search is a plain case-insensitive substring match across title,
 * tags, notes, associated course names, and type - no external index.
 */
export function filterResources(
  resources: LibraryResource[],
  query: string,
  filters: ResourceFilters,
  courses: Course[],
): LibraryResource[] {
  const normalizedQuery = query.trim().toLowerCase();

  return resources.filter((resource) => {
    if (filters.courseId && !resource.courseIds.includes(filters.courseId)) return false;
    if (filters.type && resource.type !== filters.type) return false;
    if (filters.favoritesOnly && !resource.isFavorite) return false;
    if (!normalizedQuery) return true;

    const courseNames = resource.courseIds
      .map((id) => courses.find((course) => course.id === id)?.name ?? "")
      .join(" ");

    const haystack = [
      resource.title,
      resource.tags.join(" "),
      resource.notes ?? "",
      courseNames,
      RESOURCE_TYPE_LABELS[resource.type],
      resource.type,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}
