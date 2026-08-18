/**
 * Bell schedule models.
 *
 * A BellSchedule is an ordered list of ScheduleBlocks. Order is expressed
 * purely by array position - there is no separate numeric "order" field to
 * keep in sync. A ScheduleBlock may carry any number of
 * ScheduleBlockOverrides, each scoped to a single weekday, that replace one
 * or more of the block's fields for that day only (e.g. base "Enrichment"
 * becoming "SAT Prep" on Thursdays). Overrides are generic - nothing in the
 * type system or engine hard-codes a particular weekday or course.
 */

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Coarse classification of a block, used by the scheduling engine to decide
 * things like "is this a student-facing instructional period". `custom`
 * covers anything a schedule author wants to label themselves via
 * `customKindLabel` (the "etc." in "Prep, Lunch, Passing, Enrichment, etc.").
 */
export const BLOCK_KINDS = [
  "instructional",
  "enrichment",
  "prep",
  "lunch",
  "passing",
  "custom",
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface ScheduleBlockOverride {
  id: string;
  weekday: Weekday;
  label?: string;
  kind?: BlockKind;
  customKindLabel?: string;
  /**
   * `undefined` = not overridden (fall back to the base block's value).
   * `null` = explicitly unassigned for this weekday.
   * A section id = reassigned for this weekday.
   */
  classSectionId?: string | null;
  /** 24h "HH:mm", local to the schedule's time zone. */
  startTime?: string;
  endTime?: string;
}

export interface ScheduleBlock {
  id: string;
  label: string;
  kind: BlockKind;
  customKindLabel?: string;
  /** 24h "HH:mm", local to the schedule's time zone. */
  startTime: string;
  endTime: string;
  classSectionId?: string | null;
  overrides: ScheduleBlockOverride[];
}

export interface BellSchedule {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  /** IANA time zone this schedule's start/end times are expressed in. */
  timeZone: string;
  blocks: ScheduleBlock[];
}

/**
 * The effective block for a specific weekday, after merging any matching
 * override on top of its base ScheduleBlock. This is what the current-period
 * engine and UI actually render - never the raw ScheduleBlock.
 */
export interface ResolvedScheduleBlock {
  /** Stable across weekdays; use for React keys within a single day's list. */
  id: string;
  /** The originating ScheduleBlock's id (stable across all weekdays). */
  blockId: string;
  label: string;
  kind: BlockKind;
  customKindLabel?: string;
  startTime: string;
  endTime: string;
  classSectionId?: string | null;
  isOverridden: boolean;
  overrideWeekday?: Weekday;
}
