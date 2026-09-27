import type { BlockKind } from "@/types/schedule";

/**
 * Kinds a class section may be assigned to - "can this block carry a
 * classSectionId at all", independent of whether one currently is assigned.
 * Mirrors the allowlist components/schedule/BlockRow.tsx already uses for a
 * teacher-owned schedule's own class-section picker
 * (`canAssignClass`/`nextCanAssignClass`); this is that same concept,
 * extracted so Stage E's SharedScheduleAssignmentView (organization-owned
 * schedules) can share it rather than re-derive its own copy.
 *
 * Deliberately NOT wired into components/lessons/LessonsScreen.tsx's own
 * `isTeachingBlock` local (or BlockRow.tsx/PresentModeControls.tsx's
 * copies) - LessonsScreen's own comment already documents that one as
 * known tech debt slated for a separate, out-of-scope reconciliation with
 * lib/schedule/activeSections.ts's wider `kind !== "passing"` definition;
 * touching those call sites here would be exactly the broad refactor this
 * extraction is deliberately not doing.
 */
const TEACHING_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
  "instructional",
  "enrichment",
]);

export function isTeachingBlock(kind: BlockKind): boolean {
  return TEACHING_BLOCK_KINDS.has(kind);
}
