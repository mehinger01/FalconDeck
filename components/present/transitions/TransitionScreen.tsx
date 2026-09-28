import type { ResolvedScheduleBlock } from "@/types/schedule";
import { CountdownBanner } from "../CountdownBanner";

/**
 * The automatic between-classes screen: appears the instant the schedule
 * engine reports no student-facing block is active and disappears the
 * instant the next one starts - driven entirely by `LivePresentScreen`'s
 * existing live clock, no click required. `nextBlock`/`nextDisplayName`
 * are only ever resolved from `getPresentationState`'s
 * `nextStudentFacingBlock` - which already excludes Prep, Lunch, and
 * Passing, and already resolves weekday overrides (Enrichment vs. a
 * Thursday SAT Prep block) - so nothing here re-derives or special-cases
 * any of that.
 *
 * Teacher Transition Content (Stage C): `materials`/`warmup`/`note` are
 * plain, already-resolved display strings - exactly like
 * `arrivalInstructions`, this component does no lesson/override lookup and
 * no tri-state resolution of its own; that's entirely `LivePresentScreen`'s
 * job via `resolveTransitionContent` (lib/data/transitionContent.ts).
 * `undefined` means "don't render that section" - the caller has already
 * decided that (no lesson, blank field, or an explicit hide override), so
 * this component only ever checks for presence, never re-derives meaning.
 * `arrivalInstructions` (from `ClassPresentationSettings`) stays a fully
 * independent data source from these three.
 *
 * Readability correction (Stage C revision): the transition screen is a
 * full-screen BenQ presentation, not a compact dashboard - no meaningful
 * student-facing text here relies on sub-20px type. Visual hierarchy is
 * Warm-Up > Materials > Arrival Routine >= Note; DOM order follows that
 * same priority. Every section stays independently conditional - an absent
 * section leaves no placeholder gap, it simply isn't rendered.
 *
 * Responsive correction (Stage C revision 2): at short presentation
 * heights (e.g. a 1366x768 BenQ board), Warm-Up together with everything
 * below it can exceed the viewport if stacked in one column - see the
 * `@media (max-height: 820px)` rule in globals.css. Rather than shrinking
 * any of the readability-floor font sizes below, `.transition-lower-with-warmup`
 * switches from a stacked column to a two-column layout ONLY when Warm-Up
 * is actually present (so a screen with just Materials/Arrival never gets
 * an empty, wasted column) - Warm-Up keeps the wider 3fr column, everything
 * else shares the narrower 2fr column, preserving the same visual
 * hierarchy side-by-side that stacking already established top-to-bottom.
 */
export function TransitionScreen({
  nextBlock,
  nextDisplayName,
  secondsUntilNext,
  arrivalInstructions,
  showCountdown,
  showArrivalInstructions,
  materials,
  warmup,
  note,
}: {
  nextBlock: ResolvedScheduleBlock;
  nextDisplayName: string;
  secondsUntilNext: number;
  arrivalInstructions: string[];
  showCountdown: boolean;
  showArrivalInstructions: boolean;
  /** Effective materials text, or `undefined` to render nothing (no lesson, blank, or explicitly hidden). */
  materials?: string;
  /** Effective warm-up text, or `undefined` to render nothing. Visually clamped here (3 lines normally, 2 at short presentation heights); the full value passed in is never mutated. */
  warmup?: string;
  /** Effective transition note text, or `undefined` to render nothing. */
  note?: string;
}) {
  const warmupSection = warmup && (
    <div className="transition-primary">
      <p className="transition-heading-warmup text-2xl font-bold uppercase tracking-[0.15em] text-falcon-gold-400">
        Warm-Up
      </p>
      {/* line-clamp-3 (2 at short presentation heights, see globals.css) -
          Tailwind's built-in utility, no dependency added; `warmup` itself
          is always the complete, unmutated stored value - only how many
          lines render before an ellipsis is limited. */}
      <p className="transition-body-warmup mt-2 line-clamp-3 whitespace-pre-line text-3xl font-semibold leading-tight text-falcon-cream-100">
        {warmup}
      </p>
    </div>
  );

  const materialsSection = materials && (
    <div>
      <p className="transition-heading-materials text-xl font-bold uppercase tracking-[0.15em] text-falcon-gold-400">
        Get Ready
      </p>
      {/* whitespace-pre-line: preserves the teacher's own line breaks
          without inventing bullet/list parsing over free text (see
          DailyLesson.materials's own doc comment) - the stored value is
          never mutated, only how it wraps on screen. */}
      <p className="transition-body-materials mt-2 whitespace-pre-line text-2xl text-falcon-cream-100">
        {materials}
      </p>
    </div>
  );

  const arrivalSection = showArrivalInstructions && arrivalInstructions.length > 0 && (
    <div>
      <p className="transition-heading-arrival text-xl font-bold uppercase tracking-[0.15em] text-falcon-gold-400">
        Arrival Routine
      </p>
      <ul className="transition-body-arrival mt-2 space-y-1 text-xl text-falcon-cream-100">
        {arrivalInstructions.map((instruction, index) => (
          <li key={`${index}-${instruction}`} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-falcon-gold-400">
              •
            </span>
            {instruction}
          </li>
        ))}
      </ul>
    </div>
  );

  const noteSection = note && (
    <div>
      <p className="transition-heading-note text-xl font-bold uppercase tracking-[0.15em] text-falcon-gold-400">
        Note
      </p>
      <p className="transition-body-note mt-2 whitespace-pre-line text-xl text-falcon-cream-100">{note}</p>
    </div>
  );

  const hasSecondary = Boolean(materialsSection || arrivalSection || noteSection);

  return (
    <div className="animate-present-fade flex flex-1 flex-col items-center justify-center gap-4 px-10 text-center">
      <p className="transition-eyebrow text-xl font-bold uppercase tracking-[0.3em] text-falcon-gold-400">Up Next</p>

      <div>
        <h1 className="text-5xl font-black text-falcon-cream-100 sm:text-6xl md:text-7xl">{nextDisplayName}</h1>
        <p className="mt-2 text-lg font-semibold uppercase tracking-[0.2em] text-falcon-cream-200/60">
          {nextBlock.label}
        </p>
      </div>

      {showCountdown && <CountdownBanner remainingSeconds={secondsUntilNext} label="Class Begins In" />}

      {(warmupSection || hasSecondary) && (
        <div className="w-full max-w-4xl text-left">
          {warmupSection ? (
            <div className="transition-lower-with-warmup flex flex-col gap-4">
              {warmupSection}
              {hasSecondary && (
                <div className="transition-secondary flex flex-col gap-4">
                  {materialsSection}
                  {arrivalSection}
                  {noteSection}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {materialsSection}
              {arrivalSection}
              {noteSection}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
