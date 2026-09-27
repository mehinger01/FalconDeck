/**
 * Standalone verification for Stage A of the teacher-transition-content
 * initiative (model + pure resolution helper only - no schema, no UI, no
 * Present Mode wiring yet). Not a test framework - a script with
 * assertions, run via `tsx`:
 *
 *   npm run verify:transition-content-stage-a
 *
 * Exercises `findTransitionOverride`/`resolveTransitionContent`
 * (lib/data/transitionContent.ts) directly against hand-built
 * DailyLesson/TransitionOverride fixtures - no AppData, no reducer, no
 * schedule engine involved, since this stage's helper deliberately takes an
 * already-resolved classSectionId rather than resolving one itself.
 */

import { findTransitionOverride, resolveTransitionContent } from "@/lib/data/transitionContent";
import type { DailyLesson } from "@/types/lesson";
import type { TransitionOverride } from "@/types/transitionOverride";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const DATE = "2026-09-29";
const OTHER_DATE = "2026-09-30";
const SECTION = "section-geometry-2";
const OTHER_SECTION = "section-algebra-1";

function lesson(overrides: Partial<DailyLesson> = {}): DailyLesson {
  return {
    id: "lesson-1",
    date: DATE,
    classSectionId: SECTION,
    learningTarget: "I can find the midpoint of a segment.",
    agendaItems: [],
    resources: [],
    announcements: [],
    materials: "Geometry workbook; notebook; pencil; calculator",
    warmup: "1. Find the midpoint of AB. 2. Name the angle pair shown.",
    createdAt: "2026-09-29T12:00:00.000Z",
    updatedAt: "2026-09-29T12:00:00.000Z",
    ...overrides,
  };
}

function override(patch: Partial<TransitionOverride> = {}): TransitionOverride {
  return {
    id: "override-1",
    date: DATE,
    classSectionId: SECTION,
    ...patch,
  };
}

console.log("1-2. No override -> live lesson defaults");
{
  const result = resolveTransitionContent([lesson()], [], DATE, SECTION);
  check("materials falls back to lesson.materials", result.materials === "Geometry workbook; notebook; pencil; calculator");
  check("warmup falls back to lesson.warmup", result.warmup === "1. Find the midpoint of AB. 2. Name the angle pair shown.");
  check("note is undefined with no override at all", result.note === undefined);
}

console.log("3-4. String override wins over the live lesson value");
{
  const result = resolveTransitionContent(
    [lesson()],
    [override({ materialsOverride: "Just a calculator today", warmupOverride: "Skip the warm-up, go straight to notes" })],
    DATE,
    SECTION,
  );
  check("string materials override wins", result.materials === "Just a calculator today");
  check("string warmup override wins", result.warmup === "Skip the warm-up, go straight to notes");
}

console.log("5-6. null override explicitly hides, even though the lesson has content");
{
  const result = resolveTransitionContent(
    [lesson()],
    [override({ materialsOverride: null, warmupOverride: null })],
    DATE,
    SECTION,
  );
  check("null materials override hides materials (undefined, not the lesson's text)", result.materials === undefined);
  check("null warmup override hides warmup (undefined, not the lesson's text)", result.warmup === undefined);
}

console.log("7. Removing the override (no TransitionOverride row at all) returns to the live lesson value");
{
  const withOverride = resolveTransitionContent([lesson()], [override({ materialsOverride: null })], DATE, SECTION);
  const withoutOverride = resolveTransitionContent([lesson()], [], DATE, SECTION);
  check("with the override, materials is hidden", withOverride.materials === undefined);
  check("removing the override reverts to the lesson's live materials", withoutOverride.materials === "Geometry workbook; notebook; pencil; calculator");
}

console.log("8. Editing the lesson automatically changes the effective value when no override exists");
{
  const before = resolveTransitionContent([lesson()], [], DATE, SECTION);
  const edited = resolveTransitionContent([lesson({ materials: "New: graph paper only", warmup: "New warm-up text" })], [], DATE, SECTION);
  check("materials changed automatically with the lesson edit, no override involved", before.materials !== edited.materials && edited.materials === "New: graph paper only");
  check("warmup changed automatically with the lesson edit, no override involved", before.warmup !== edited.warmup && edited.warmup === "New warm-up text");
}

console.log("9. Note resolves independently of the lesson (no live default exists for it)");
{
  const noNote = resolveTransitionContent([lesson()], [override()], DATE, SECTION);
  const withNote = resolveTransitionContent([lesson()], [override({ note: "Homework on desk when bell rings." })], DATE, SECTION);
  check("no note on the override -> undefined", noNote.note === undefined);
  check("a note on the override shows regardless of lesson content", withNote.note === "Homework on desk when bell rings.");
}

console.log("10. No lesson for the date/section returns empty defaults safely, no crash");
{
  const result = resolveTransitionContent([], [], DATE, SECTION);
  check("lesson is null", result.lesson === null);
  check("materials is undefined", result.materials === undefined);
  check("warmup is undefined", result.warmup === undefined);
}

console.log("11. An override can exist without any lesson for that date/section");
{
  const result = resolveTransitionContent(
    [],
    [override({ materialsOverride: "Movie day - no materials needed", note: "Bring nothing, just yourselves." })],
    DATE,
    SECTION,
  );
  check("lesson is still null", result.lesson === null);
  check("the override's materials text is shown even with no backing lesson", result.materials === "Movie day - no materials needed");
  check("the override's note is shown even with no backing lesson", result.note === "Bring nothing, just yourselves.");
}

console.log("12. No classSectionId (null or undefined) returns no lesson-derived content safely");
{
  const withNull = resolveTransitionContent([lesson()], [override()], DATE, null);
  const withUndefined = resolveTransitionContent([lesson()], [override()], DATE, undefined);
  check("null classSectionId -> classSectionId null, lesson null, no crash", withNull.classSectionId === null && withNull.lesson === null && withNull.materials === undefined);
  check("undefined classSectionId -> same safe empty result", withUndefined.classSectionId === null && withUndefined.lesson === null && withUndefined.materials === undefined);
}

console.log("13. findTransitionOverride mirrors findLessonForSection's (date, classSectionId) lookup exactly");
{
  const overrides = [override(), override({ id: "override-2", date: OTHER_DATE, classSectionId: SECTION }), override({ id: "override-3", date: DATE, classSectionId: OTHER_SECTION })];
  check("finds the matching (date, classSectionId) row", findTransitionOverride(overrides, DATE, SECTION)?.id === "override-1");
  check("a different date for the same section does not match", findTransitionOverride(overrides, OTHER_DATE, SECTION)?.id === "override-2");
  check("a different section on the same date does not match", findTransitionOverride(overrides, DATE, OTHER_SECTION)?.id === "override-3");
  check("no match returns null, never throws", findTransitionOverride([], DATE, SECTION) === null);
}

console.log(
  "\n(14. AppData backward compatibility - existing data lacking transitionOverrides/DailyLesson lacking warmup - " +
    "is verified structurally via `npx tsc --noEmit` across every AppData producer, not exercised here: this script " +
    "only covers the pure resolution helper's own behavior.)",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
