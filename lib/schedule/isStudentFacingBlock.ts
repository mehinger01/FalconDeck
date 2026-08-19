import type { BlockKind } from "@/types/schedule";

/**
 * Kinds that put students in front of the classroom presentation screen.
 * "enrichment" belongs here unconditionally - a weekday override (like
 * Thursday's SAT Prep substitution) changes what content plays, not whether
 * the block is student-facing, so this list must never be special-cased by
 * weekday or by the specific course/section assigned to a block.
 */
const STUDENT_FACING_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
  "instructional",
  "enrichment",
]);

/**
 * True for any block kind that should show the classroom/student
 * presentation view (Present Mode's ClassroomView) rather than a private or
 * transition screen. This is the single source of truth for "is this
 * student-facing" - schedule/presentation logic should call this instead of
 * comparing `kind === "instructional"` directly.
 */
export function isStudentFacingBlock(block: { kind: BlockKind }): boolean {
  return STUDENT_FACING_KINDS.has(block.kind);
}
