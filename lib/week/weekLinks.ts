/**
 * Centralized URL-building for links the Week grid opens into - so a date
 * or query-param name never needs to be typed out twice. Both routes
 * already exist (Phase 2's Lessons editor, Phase 2.5's Present Mode
 * Preview); Week only ever links to them, never reimplements them.
 */

/** `/lessons?date=...&section=...` - Phase 2's existing lesson editor. */
export function buildLessonEditUrl(date: string, classSectionId: string): string {
  const params = new URLSearchParams({ date, section: classSectionId });
  return `/lessons?${params.toString()}`;
}

/**
 * `/present?mode=preview&date=...&section=...[&block=...]` - Phase 2.5's
 * existing bookmarkable Present Mode preview. `blockId` is optional: pass
 * it when a real schedule block was cleanly resolved for this date/section
 * (see `WeekCell.scheduledBlockId`); omit it and Preview Mode falls back
 * to its own generic placeholder block, exactly as it already does.
 */
export function buildPreviewUrl(date: string, classSectionId: string, blockId?: string | null): string {
  const params = new URLSearchParams({ mode: "preview", date, section: classSectionId });
  if (blockId) params.set("block", blockId);
  return `/present?${params.toString()}`;
}
