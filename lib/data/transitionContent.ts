import { findLessonForSection } from "@/lib/data/lessons";
import type { DailyLesson } from "@/types/lesson";
import type { TransitionOverride } from "@/types/transitionOverride";

/**
 * What Present Mode's transition/passing screen should actually display for
 * a given date and destination class - the combination of that day's live
 * `DailyLesson` (materials/warmup) with any `TransitionOverride` on top of
 * it. See `resolveTransitionContent`'s own doc comment for the exact
 * per-field semantics.
 */
export interface ResolvedTransitionContent {
  /** Echoes the input, `null` when no destination class was resolved (e.g. Prep/Enrichment-with-no-section, or nothing left today). */
  classSectionId: string | null;
  /** The date/section's DailyLesson, if any - exposed for callers that need more than materials/warmup (e.g. the editor UI in a later stage). */
  lesson: DailyLesson | null;
  /** The date/section's TransitionOverride, if any - same reason. */
  override: TransitionOverride | null;
  /** Effective materials to show, or `undefined` to show nothing (no lesson, no materials, or explicitly hidden). */
  materials: string | undefined;
  /** Effective warm-up to show, or `undefined` to show nothing. */
  warmup: string | undefined;
  /** Effective transition note to show, or `undefined` to show nothing - purely from the override, no live default exists for this field. */
  note: string | undefined;
}

/**
 * Looks up the one TransitionOverride for a given school-local date and
 * (destination) class section, or `null` if the teacher has never
 * customized that day's transition content. Mirrors `findLessonForSection`
 * exactly - same `(date, classSectionId)` key, same "absence means
 * nothing configured, never a stored empty row" contract.
 */
export function findTransitionOverride(
  overrides: TransitionOverride[],
  date: string,
  classSectionId: string,
): TransitionOverride | null {
  return overrides.find((override) => override.date === date && override.classSectionId === classSectionId) ?? null;
}

/**
 * Tri-state resolution for one overridable field:
 * - `override` is `undefined` (teacher has not touched this field) -> use
 *   the lesson's live value (itself possibly `undefined`, e.g. no lesson or
 *   a blank field - that already means "show nothing", so no extra
 *   coercion is needed here).
 * - `override` is `null` -> explicitly hidden, regardless of what the live
 *   lesson value is.
 * - `override` is a string -> shown verbatim instead of the live value,
 *   even when it's `""` (an override IS the teacher's explicit choice; this
 *   function never re-interprets an override's own content).
 */
function resolveOverridableField(
  liveValue: string | undefined,
  override: string | null | undefined,
): string | undefined {
  if (override === undefined) return liveValue;
  if (override === null) return undefined;
  return override;
}

/**
 * The single place "what does the transition screen show for this date and
 * destination class" is answered. Deliberately takes an already-resolved
 * `classSectionId` rather than a schedule/block - next-teaching-block
 * resolution (weekday overrides, SPECIAL_BELL, shared-schedule
 * `teacherPeriodAssignments` merges, skipping Lunch/Prep/Passing) is the
 * existing canonical Present Mode resolver's job
 * (`getScheduleState`/`getNextStudentFacingBlock`) - this function must
 * never re-derive or duplicate that. Never copies a lesson's materials/
 * warmup INTO a TransitionOverride - defaults stay live-derived on every
 * call, by construction, since this only ever reads `lessons` and
 * `transitionOverrides`, never writes either.
 */
export function resolveTransitionContent(
  lessons: DailyLesson[],
  transitionOverrides: TransitionOverride[],
  date: string,
  classSectionId: string | null | undefined,
): ResolvedTransitionContent {
  if (!classSectionId) {
    return { classSectionId: null, lesson: null, override: null, materials: undefined, warmup: undefined, note: undefined };
  }

  const lesson = findLessonForSection(lessons, date, classSectionId);
  const override = findTransitionOverride(transitionOverrides, date, classSectionId);

  return {
    classSectionId,
    lesson,
    override,
    materials: resolveOverridableField(lesson?.materials, override?.materialsOverride),
    warmup: resolveOverridableField(lesson?.warmup, override?.warmupOverride),
    note: override?.note || undefined,
  };
}
