import type { ClassSection } from "@/types/course";
import type { DailyLesson, ResourceType } from "@/types/lesson";

/** Display labels for `ResourceType`, shared by the Lessons editor and Present Mode. */
export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  link: "Link",
  document: "Document",
  slides: "Slides",
  video: "Video",
  desmos: "Desmos",
  calculator: "Calculator",
  pdf: "PDF",
  image: "Image",
  spreadsheet: "Spreadsheet",
  other: "Other",
};

/**
 * Looks up the one DailyLesson for a given school-local date and class
 * section, or `null` if nothing has been prepared. This is the only place
 * "does a lesson exist for X" should be answered - Present Mode's no-lesson
 * state and the Lessons screen's editor both go through here.
 */
export function findLessonForSection(
  lessons: DailyLesson[],
  date: string,
  classSectionId: string,
): DailyLesson | null {
  return lessons.find((lesson) => lesson.date === date && lesson.classSectionId === classSectionId) ?? null;
}

/**
 * Sections eligible as a "Copy -> Another Period" destination for
 * `sourceSectionId`: any section teaching the same course, other than the
 * source section itself. Sections belonging to a different course are
 * never offered - copying a lesson across courses isn't a supported flow.
 */
export function getCopyDestinationSections(
  classSections: ClassSection[],
  sourceSectionId: string,
): ClassSection[] {
  const source = classSections.find((section) => section.id === sourceSectionId);
  if (!source) return [];
  return classSections.filter(
    (section) => section.id !== sourceSectionId && section.courseId === source.courseId,
  );
}
