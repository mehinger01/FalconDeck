import type { ClassSection, Course } from "@/types/course";

/** Looks up a class section by id. Returns `null` for `null`/`undefined`/unknown ids. */
export function resolveClassSection(
  sections: ClassSection[],
  classSectionId: string | null | undefined,
): ClassSection | null {
  if (!classSectionId) return null;
  return sections.find((section) => section.id === classSectionId) ?? null;
}

/** Looks up the Course a given ClassSection belongs to. */
export function resolveCourseForSection(
  courses: Course[],
  section: ClassSection | null,
): Course | null {
  if (!section) return null;
  return courses.find((course) => course.id === section.courseId) ?? null;
}
