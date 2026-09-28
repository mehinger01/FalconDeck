/**
 * Standalone verification for Stage C of the teacher-transition-content
 * initiative: Present Mode's transition screen now displays materials/
 * warm-up/note automatically (rendering only - no editing UI, no schema
 * change). Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:transition-content-stage-c
 *
 * Split into three parts, per instructions to prefer testing the resolver
 * separately from rendering:
 *   A. Pure resolver behavior (resolveTransitionContent/getArrivalInstructions)
 *      - no schedule engine, no components.
 *   B. Resolver chained onto real schedule-engine output (getPresentationState)
 *      - proves the SAME nextStudentFacingBlock this stage consumes still
 *        resolves enrichment and multi-non-teaching-block chains correctly,
 *        and that resolveTransitionContent composes with it with no drift.
 *   C. Static source-scan regressions - countdown threshold, the Demo Mode
 *      final-30 scenario, EndOfDay/Lunch branches, TransitionScreen's
 *      presentation-only purity, and "no write path introduced" - all
 *      things a DOM-free script can prove by reading the files rather than
 *      rendering them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTransitionContent } from "@/lib/data/transitionContent";
import { getArrivalInstructions } from "@/lib/data/classPresentation";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { COUNTDOWN_THRESHOLD_SECONDS, shouldShowCountdown } from "@/lib/schedule/getRemainingTime";
import type { DailyLesson } from "@/types/lesson";
import type { TransitionOverride } from "@/types/transitionOverride";
import type { ClassPresentationSettings } from "@/types/classPresentation";
import type { BellSchedule } from "@/types/schedule";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const DATE = "2026-01-05";
const SECTION_A = "section-algebra-1";
const SECTION_B = "section-enrichment";
const SECTION_C = "section-geometry-3";

function lesson(patch: Partial<DailyLesson> = {}): DailyLesson {
  return {
    id: "lesson-a",
    date: DATE,
    classSectionId: SECTION_A,
    learningTarget: "Target",
    agendaItems: [],
    resources: [],
    announcements: [],
    materials: undefined,
    warmup: undefined,
    createdAt: "2026-01-05T12:00:00.000Z",
    updatedAt: "2026-01-05T12:00:00.000Z",
    ...patch,
  };
}

function override(patch: Partial<TransitionOverride> = {}): TransitionOverride {
  return { id: "override-a", date: DATE, classSectionId: SECTION_A, ...patch };
}

// ---------------------------------------------------------------------------
// A. Pure resolver behavior
// ---------------------------------------------------------------------------

console.log("1-3. Materials/warm-up appear individually and together, no override involved");
{
  const materialsOnly = resolveTransitionContent([lesson({ materials: "Workbook" })], [], DATE, SECTION_A);
  check("1. materials appears when the lesson has materials", materialsOnly.materials === "Workbook");
  check("1b. warmup stays absent when the lesson has none", materialsOnly.warmup === undefined);

  const warmupOnly = resolveTransitionContent([lesson({ warmup: "Solve for x" })], [], DATE, SECTION_A);
  check("2. warm-up appears when the lesson has one", warmupOnly.warmup === "Solve for x");
  check("2b. materials stays absent when the lesson has none", warmupOnly.materials === undefined);

  const both = resolveTransitionContent([lesson({ materials: "Workbook", warmup: "Solve for x" })], [], DATE, SECTION_A);
  check("3. both appear together", both.materials === "Workbook" && both.warmup === "Solve for x");
}

console.log("\n4-5. Empty states: no lesson, and no class assignment");
{
  const noLesson = resolveTransitionContent([], [], DATE, SECTION_A);
  check("4. no lesson -> materials absent", noLesson.materials === undefined);
  check("4b. no lesson -> warmup absent", noLesson.warmup === undefined);

  const noSection = resolveTransitionContent([lesson({ materials: "Workbook", warmup: "Solve for x" })], [], DATE, null);
  check("5. no class assignment -> materials absent", noSection.materials === undefined);
  check("5b. no class assignment -> warmup absent", noSection.warmup === undefined);
  check("5c. no class assignment -> classSectionId echoes null", noSection.classSectionId === null);
}

console.log("\n6-9. Override wins / hide works, for both fields independently");
{
  const materialsOverrideWins = resolveTransitionContent(
    [lesson({ materials: "Live workbook" })],
    [override({ materialsOverride: "Custom override" })],
    DATE,
    SECTION_A,
  );
  check("6. materials override wins over the live lesson value", materialsOverrideWins.materials === "Custom override");

  const warmupOverrideWins = resolveTransitionContent(
    [lesson({ warmup: "Live warmup" })],
    [override({ warmupOverride: "Custom warmup" })],
    DATE,
    SECTION_A,
  );
  check("7. warmup override wins over the live lesson value", warmupOverrideWins.warmup === "Custom warmup");

  const materialsHidden = resolveTransitionContent(
    [lesson({ materials: "Live workbook" })],
    [override({ materialsOverride: null })],
    DATE,
    SECTION_A,
  );
  check("8. materials hide works even with a live lesson value present", materialsHidden.materials === undefined);

  const warmupHidden = resolveTransitionContent(
    [lesson({ warmup: "Live warmup" })],
    [override({ warmupOverride: null })],
    DATE,
    SECTION_A,
  );
  check("9. warmup hide works even with a live lesson value present", warmupHidden.warmup === undefined);
}

console.log("\n10. Override without a lesson still works");
{
  const result = resolveTransitionContent(
    [],
    [override({ materialsOverride: "Movie day - nothing needed", warmupOverride: "N/A", note: "No lesson today" })],
    DATE,
    SECTION_A,
  );
  check("10. materials override shows with no backing lesson", result.materials === "Movie day - nothing needed");
  check("10b. warmup override shows with no backing lesson", result.warmup === "N/A");
  check("10c. note shows with no backing lesson", result.note === "No lesson today");
}

console.log("\n11-12. Note displays when present, never when blank/absent");
{
  const withNote = resolveTransitionContent([lesson()], [override({ note: "Homework on desk." })], DATE, SECTION_A);
  check("11. note displays when present", withNote.note === "Homework on desk.");

  const noOverrideAtAll = resolveTransitionContent([lesson()], [], DATE, SECTION_A);
  check("12. no override at all -> note absent", noOverrideAtAll.note === undefined);
  const blankNote = resolveTransitionContent([lesson()], [override({ note: "" })], DATE, SECTION_A);
  check("12b. an explicitly blank note -> note absent (never an empty visible section)", blankNote.note === undefined);
}

console.log("\n13. Arrival instructions are a fully independent data source - unaffected by lessons/overrides/transition content");
{
  const settings: ClassPresentationSettings[] = [{ classSectionId: SECTION_A, arrivalInstructions: ["Chromebook open", "Notebook out"] }];
  const withRichTransitionContent = resolveTransitionContent(
    [lesson({ materials: "Workbook", warmup: "Solve for x" })],
    [override({ note: "Reminder" })],
    DATE,
    SECTION_A,
  );
  const arrival = getArrivalInstructions(settings, SECTION_A);
  check(
    "13. arrival instructions resolve the same regardless of how rich (or empty) the transition content is",
    arrival.length === 2 && arrival[0] === "Chromebook open" && withRichTransitionContent.materials === "Workbook",
  );
  const arrivalWithNoLessonAtAll = getArrivalInstructions(settings, SECTION_A);
  check("13b. arrival instructions still resolve with zero lessons/overrides in scope", arrivalWithNoLessonAtAll.length === 2);
}

// ---------------------------------------------------------------------------
// B. Resolver chained onto real schedule-engine output
// ---------------------------------------------------------------------------

console.log("\n14-15. Chained onto getPresentationState: enrichment-next, and multiple non-teaching blocks in between");
{
  const schedule: BellSchedule = {
    id: "schedule-1",
    name: "Test Schedule",
    ownerType: "teacher",
    isDefault: true,
    timeZone: "America/Detroit",
    blocks: [
      { id: "p1", label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: SECTION_A, overrides: [] },
      { id: "passing1", label: "Passing", kind: "passing", startTime: "08:50", endTime: "08:55", classSectionId: null, overrides: [] },
      { id: "p2", label: "Period 2", kind: "enrichment", startTime: "08:55", endTime: "09:45", classSectionId: SECTION_B, overrides: [] },
      { id: "passing2", label: "Passing", kind: "passing", startTime: "09:45", endTime: "09:50", classSectionId: null, overrides: [] },
      { id: "lunch", label: "Lunch", kind: "lunch", startTime: "09:50", endTime: "10:20", classSectionId: null, overrides: [] },
      { id: "passing3", label: "Passing", kind: "passing", startTime: "10:20", endTime: "10:25", classSectionId: null, overrides: [] },
      { id: "p3", label: "Period 3", kind: "instructional", startTime: "10:25", endTime: "11:15", classSectionId: SECTION_C, overrides: [] },
    ],
  };
  const lessons: DailyLesson[] = [
    lesson({ id: "lesson-b", classSectionId: SECTION_B, materials: "Enrichment folder", warmup: "Check your grades" }),
    lesson({ id: "lesson-c", classSectionId: SECTION_C, materials: "Compass" }),
  ];

  function atLocalTime(time: string): Date {
    return new Date(`${DATE}T${time}:00-05:00`);
  }

  const duringPassing1 = getPresentationState(schedule, atLocalTime("08:52"));
  check(
    "14. from inside the passing block before it, the next student-facing block is the ENRICHMENT period (not skipped)",
    duringPassing1.mode === "transition" && duringPassing1.nextStudentFacingBlock?.classSectionId === SECTION_B && duringPassing1.nextStudentFacingBlock?.kind === "enrichment",
  );
  if (duringPassing1.mode === "transition" && duringPassing1.nextStudentFacingBlock) {
    const content = resolveTransitionContent(lessons, [], DATE, duringPassing1.nextStudentFacingBlock.classSectionId);
    check("14b. that enrichment block's classSectionId resolves its own lesson's materials/warmup with zero special-casing", content.materials === "Enrichment folder" && content.warmup === "Check your grades");
  }

  const duringPassing2 = getPresentationState(schedule, atLocalTime("09:47"));
  check(
    "15. from the passing block between Enrichment and Lunch, the next student-facing block SKIPS Lunch and both passing blocks, landing on Period 3",
    duringPassing2.mode === "transition" && duringPassing2.nextStudentFacingBlock?.classSectionId === SECTION_C,
  );

  const duringPassing3 = getPresentationState(schedule, atLocalTime("10:22"));
  check(
    "15b. from the LAST passing block before Period 3, the next student-facing block is still the same Period 3 - the resolver agrees no matter which non-teaching block you're currently in",
    duringPassing3.mode === "transition" && duringPassing3.nextStudentFacingBlock?.classSectionId === SECTION_C,
  );
  if (duringPassing3.mode === "transition" && duringPassing3.nextStudentFacingBlock) {
    const content = resolveTransitionContent(lessons, [], DATE, duringPassing3.nextStudentFacingBlock.classSectionId);
    check("15c. Period 3's resolved classSectionId feeds resolveTransitionContent correctly", content.materials === "Compass");
  }

  const duringLunch = getPresentationState(schedule, atLocalTime("10:00"));
  check(
    "no-regression: Lunch itself is still reported as the active block, not folded into the transition/next-class path",
    duringLunch.mode === "transition" && duringLunch.currentBlock?.kind === "lunch",
  );
}

// ---------------------------------------------------------------------------
// C. Static source-scan regressions
// ---------------------------------------------------------------------------

function readSource(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

console.log("\n16. Countdown threshold is unchanged (still exactly 5:00)");
check("16. COUNTDOWN_THRESHOLD_SECONDS is still 300", COUNTDOWN_THRESHOLD_SECONDS === 300);
check("16b. shouldShowCountdown(300) is true, shouldShowCountdown(301) is false - the boundary is unchanged", shouldShowCountdown(300) === true && shouldShowCountdown(301) === false);

console.log("\n17. The Demo Mode 'Final 30 Seconds' scenario still exists, unchanged in meaning");
{
  const demoSource = readSource("components", "demo", "DemoPresentSimulator.tsx");
  check('17. "final-thirty" scenario id is still present', demoSource.includes('id: "final-thirty"'));
  check('17b. its description still reads "30 seconds before" the block ends, not repurposed', demoSource.includes("30 seconds before"));
}

console.log("\n18-19. EndOfDay and Lunch branches are structurally untouched by Stage C");
{
  const liveSource = readSource("components", "present", "LivePresentScreen.tsx");
  check(
    "18. EndOfDayScreen is still rendered exactly when there's no nextStudentFacingBlock, with the same settings props",
    /<EndOfDayScreen show=\{settings\.showEndOfDayScreen\} message=\{settings\.endOfDayMessage\} \/>/.test(liveSource),
  );
  check(
    "19. LunchScreen is still rendered exactly on currentBlock.kind === \"lunch\", untouched",
    /currentBlock\?\.kind === "lunch" \? \(\s*<LunchScreen block=\{state\.currentBlock\} \/>/.test(liveSource),
  );
  check(
    "19b. transition content is never resolved for Lunch (nextTransitionContent excludes currentBlock.kind === \"lunch\")",
    liveSource.includes('state.currentBlock?.kind !== "lunch"'),
  );
}

console.log("\n20. TransitionScreen remains presentation-only - no data/repository/lookup imports");
{
  const transitionScreenSource = readSource("components", "present", "transitions", "TransitionScreen.tsx");
  // Scans only actual `import ... from "..."` lines, not prose - the
  // component's own doc comment legitimately NAMES resolveTransitionContent
  // to explain whose job resolution is (LivePresentScreen's, not this
  // component's), which a naive whole-file substring scan would wrongly
  // flag as a purity violation.
  const importLines = transitionScreenSource
    .split("\n")
    .filter((line) => line.trim().startsWith("import "))
    .join("\n");
  const forbiddenImportSources = ["@/lib/data", "@/lib/store", "@/lib/schedule"];
  const found = forbiddenImportSources.filter((needle) => importLines.includes(needle));
  check(
    `20. TransitionScreen.tsx's import statements reference none of: ${forbiddenImportSources.join(", ")} (found: ${found.join(", ") || "none"})`,
    found.length === 0,
  );
  check(
    "20b. TransitionScreen.tsx never invokes resolveTransitionContent/findLessonForSection/findTransitionOverride itself (calls, not just the word in prose)",
    !/resolveTransitionContent\(|findLessonForSection\(|findTransitionOverride\(/.test(transitionScreenSource),
  );
}

console.log("\n21. Stage C introduces no repository write path");
{
  const liveSource = readSource("components", "present", "LivePresentScreen.tsx");
  const transitionScreenSource = readSource("components", "present", "transitions", "TransitionScreen.tsx");
  const transitionContentSource = readSource("lib", "data", "transitionContent.ts");
  const writeSignatures = [".save(", "applyDiff", "actions.set", "actions.upsert", "actions.add", "actions.update", "actions.delete", "supabase.from", ".insert(", ".upsert(", ".update("];
  const offenders = [
    ["LivePresentScreen.tsx", liveSource],
    ["TransitionScreen.tsx", transitionScreenSource],
    ["transitionContent.ts", transitionContentSource],
  ].flatMap(([name, source]) => writeSignatures.filter((needle) => source.includes(needle)).map((needle) => `${name}:${needle}`));
  check(`21. none of the Stage C files contain a write-path signature (found: ${offenders.join(", ") || "none"})`, offenders.length === 0);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
