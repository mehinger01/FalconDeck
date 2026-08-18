import type {
  BellSchedule,
  ResolvedScheduleBlock,
  ScheduleBlock,
  Weekday,
} from "@/types/schedule";

/**
 * Merges a ScheduleBlock with whichever override (if any) matches `weekday`.
 * This is the ONLY place base-block/override merging happens - every other
 * engine function resolves blocks through here so a weekday override (like
 * "Thursday Enrichment becomes SAT Prep") behaves identically everywhere
 * without being special-cased anywhere else.
 */
export function resolveBlockOverride(
  block: ScheduleBlock,
  weekday: Weekday,
): ResolvedScheduleBlock {
  const override = block.overrides.find((o) => o.weekday === weekday);

  return {
    id: override ? `${block.id}:${weekday}` : block.id,
    blockId: block.id,
    label: override?.label ?? block.label,
    kind: override?.kind ?? block.kind,
    customKindLabel: override?.customKindLabel ?? block.customKindLabel,
    startTime: override?.startTime ?? block.startTime,
    endTime: override?.endTime ?? block.endTime,
    classSectionId:
      override && "classSectionId" in override
        ? override.classSectionId
        : block.classSectionId,
    isOverridden: Boolean(override),
    overrideWeekday: override ? weekday : undefined,
  };
}

/**
 * Resolves every block in `schedule` for `weekday`, preserving the base
 * schedule's block order.
 */
export function resolveScheduleForWeekday(
  schedule: BellSchedule,
  weekday: Weekday,
): ResolvedScheduleBlock[] {
  return schedule.blocks.map((block) => resolveBlockOverride(block, weekday));
}
