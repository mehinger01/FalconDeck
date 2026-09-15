import type { BellSchedule } from "@/types/schedule";

/**
 * Falcon Deck's one canonical definition of "active" (currently taught)
 * for a ClassSection: it appears as `classSectionId` on at least one
 * non-passing block in `schedule` - the schedule's own base blocks, not
 * resolved per weekday (a Thursday-only override swapping a block's
 * section doesn't change which sections are structurally "in" the
 * schedule). Maps each such section to its earliest matching start time.
 *
 * Originally inline in `WeekScreen.tsx`; extracted so Week View and the
 * lesson importer's `buildLessonImportPreview` can never silently
 * disagree about which sections belong to a course - see the "importer
 * targeted 5 Algebra sections, Week View showed 3" bug this fixes. Every
 * caller wanting just membership can do `new Set(result.keys())`.
 */
export function resolveActiveSectionStartTimes(schedule: BellSchedule | null): Map<string, string> {
  const result = new Map<string, string>();
  if (!schedule) return result;

  for (const block of schedule.blocks) {
    if (block.kind === "passing" || !block.classSectionId) continue;
    const current = result.get(block.classSectionId);
    if (!current || block.startTime < current) {
      result.set(block.classSectionId, block.startTime);
    }
  }

  return result;
}
