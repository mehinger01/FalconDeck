import type { ClassPresentationSettings } from "@/types/classPresentation";

/** The one `ClassPresentationSettings` entry for a section, or `null` if none is configured. */
export function findClassPresentationSettings(
  settings: ClassPresentationSettings[],
  classSectionId: string,
): ClassPresentationSettings | null {
  return settings.find((entry) => entry.classSectionId === classSectionId) ?? null;
}

/** The arrival routine for a section - `[]` if none is configured (never `null`, so callers can render directly). */
export function getArrivalInstructions(
  settings: ClassPresentationSettings[],
  classSectionId: string | null | undefined,
): string[] {
  if (!classSectionId) return [];
  return findClassPresentationSettings(settings, classSectionId)?.arrivalInstructions ?? [];
}
