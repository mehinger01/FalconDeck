import { useAppData } from "@/lib/store/AppDataProvider";
import { resolveClassSection, resolveCourseForSection } from "@/lib/data/resolve";

/** Course name (falling back to section name) for a class section - shared by Live and Preview. */
export function useDisplayName(classSectionId: string | null | undefined): string {
  const { data } = useAppData();
  const section = resolveClassSection(data.classSections, classSectionId);
  const course = resolveCourseForSection(data.courses, section);
  return course?.name ?? section?.name ?? "No Class Assigned";
}
