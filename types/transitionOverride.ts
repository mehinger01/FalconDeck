/**
 * Teacher transition content models.
 *
 * A TransitionOverride is a teacher-owned overlay for what Present Mode's
 * automatic passing/transition screen shows before a specific class, on a
 * specific day - see `lib/data/transitionContent.ts`'s `resolveTransitionContent`
 * for how it combines with that day's live `DailyLesson` (materials/warmup)
 * to produce what actually displays.
 *
 * Keyed by `(date, classSectionId)` - the SAME invariant `DailyLesson`
 * already uses (see `findLessonForSection`) - never by scheduleId, blockId,
 * or block position. The destination class's lesson is what this content is
 * about; which schedule block that class happens to occupy today is the
 * canonical Present Mode resolver's job (`getNextStudentFacingBlock`), not
 * this model's. Keying this way is also what lets an override survive
 * schedule changes, weekday overrides, SPECIAL_BELL schedules, and the same
 * class appearing in a different block on a different day, with zero extra
 * logic here.
 *
 * Deliberately independent of `DailyLesson` (no lessonId, no foreign key) -
 * a teacher can hide materials or leave a transition note on a day with no
 * lesson written yet for that section (see Section 13 of the transition-
 * content design report: "no lesson today" must resolve safely). At most
 * one TransitionOverride exists per `(date, classSectionId)` pair; its
 * absence from `AppData.transitionOverrides` means "no override at all",
 * never a stored empty/default row.
 */
export interface TransitionOverride {
  /** Client-generated, `generateId("transition-override")` - same convention as DailyLesson.id (see lib/store/lessonActions.ts), not a UUID. */
  id: string;
  /** School-local date, "YYYY-MM-DD" - see `getLocalDateKey`. Same convention as DailyLesson.date. */
  date: string;
  /** The destination class this transition content is FOR - i.e. the class a passing period leads into, not the passing block itself. */
  classSectionId: string;
  /**
   * Tri-state override of the day's lesson materials (see
   * `resolveTransitionContent`):
   * - `undefined` (key absent/not set) - no override; show the live
   *   `DailyLesson.materials` for this date/section.
   * - `null` - explicitly hidden; never show a materials section, even if
   *   the lesson has materials.
   * - a string - explicit custom text; shown verbatim instead of the
   *   lesson's own materials.
   *
   * This mirrors `ScheduleBlockOverride.classSectionId`'s existing
   * undefined/null/value convention (see types/schedule.ts) rather than
   * inventing a new one.
   */
  materialsOverride?: string | null;
  /** Same tri-state convention as `materialsOverride`, applied to `DailyLesson.warmup` instead. */
  warmupOverride?: string | null;
  /**
   * A teacher's free-text transition note/reminder - purely additive, with
   * no live-derived default to fall back to (there is no "lesson note"
   * field this could override). `undefined` or blank means nothing is
   * shown; any other text is shown as-is. Not a tri-state field.
   */
  note?: string;
}
