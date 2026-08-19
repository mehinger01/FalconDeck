/**
 * Standalone verification for the Phase 1 architecture-review fixes:
 *
 *   1. Enrichment is student-facing on any weekday, not just when a
 *      weekday override (Thursday SAT Prep) happens to promote it to
 *      "instructional" - and the classification is driven by the shared
 *      `isStudentFacingBlock` predicate everywhere, never a special case.
 *   2. AppData persistence goes through the `DataRepository` abstraction
 *      (`LocalStorageDataRepository`), not ad hoc localStorage calls.
 *
 * Not a test framework - just a script with assertions, run via `tsx` (the
 * only thing that gets us tsconfig `@/*` path aliases without pulling in a
 * full test runner for Phase 1):
 *
 *   npm run verify:schedule
 */

import { isStudentFacingBlock } from "@/lib/schedule/isStudentFacingBlock";
import { getNextStudentFacingBlock } from "@/lib/schedule/getNextBlock";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { DEMO_SCHEDULES, createDemoAppData } from "@/lib/data/demoData";
import { LocalStorageDataRepository } from "@/lib/data/localStorageRepository";
import type { BlockKind } from "@/types/schedule";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

// Fixed, unambiguous (both EDT, no DST edge) 2026 calendar dates so results
// don't depend on the day this script happens to run.
const MONDAY = "2026-08-17"; // -04:00 (America/Detroit, EDT)
const THURSDAY = "2026-08-20"; // -04:00 (America/Detroit, EDT)

function atLocalTime(isoDate: string, hhmm: string): Date {
  return new Date(`${isoDate}T${hhmm}:00-04:00`);
}

const schedule = DEMO_SCHEDULES.find((s) => s.id === "schedule-demo-standard")!;

console.log("1. isStudentFacingBlock predicate");
const kindExpectations: Array<[BlockKind, boolean]> = [
  ["instructional", true],
  ["enrichment", true],
  ["prep", false],
  ["lunch", false],
  ["passing", false],
];
for (const [kind, expected] of kindExpectations) {
  check(`kind "${kind}" -> ${expected}`, isStudentFacingBlock({ kind }) === expected);
}

console.log("\n2. Monday Enrichment (no override) is student-facing");
{
  const now = atLocalTime(MONDAY, "09:55"); // inside 09:48-10:08 Enrichment block
  const state = getPresentationState(schedule, now);
  check('mode is "student-facing"', state.mode === "student-facing");
  if (state.mode === "student-facing") {
    check('block.kind is "enrichment"', state.block.kind === "enrichment");
    check("block is not overridden", state.block.isOverridden === false);
  }
}

console.log("\n3. Thursday SAT Prep override is still student-facing");
{
  const now = atLocalTime(THURSDAY, "09:55"); // same block, Thursday override applied
  const state = getPresentationState(schedule, now);
  check('mode is "student-facing"', state.mode === "student-facing");
  if (state.mode === "student-facing") {
    check('block.kind is "instructional" (post-override)', state.block.kind === "instructional");
    check('block.label is "SAT Prep"', state.block.label === "SAT Prep");
    check("block.isOverridden is true", state.block.isOverridden === true);
  }
}

console.log("\n4. Prep remains a private, non-student-facing view");
{
  const now = atLocalTime(MONDAY, "11:10"); // inside 11:06-11:56 Prep block
  const state = getPresentationState(schedule, now);
  check('mode is "prep"', state.mode === "prep");
}

console.log("\n5. Lunch and Passing remain non-student-facing transitions");
{
  const lunch = getPresentationState(schedule, atLocalTime(MONDAY, "12:05"));
  check('Lunch -> mode "transition"', lunch.mode === "transition");

  const passing = getPresentationState(schedule, atLocalTime(MONDAY, "09:41"));
  check('Passing -> mode "transition"', passing.mode === "transition");
}

console.log("\n6. Next student-facing block lookup surfaces Enrichment");
{
  // During the passing period, Enrichment (not yet started) is the very
  // next student-facing block - it must not be skipped the way a
  // "kind === instructional" filter would skip it.
  const next = getNextStudentFacingBlock(schedule, atLocalTime(MONDAY, "09:41"));
  check("next block exists", next !== null);
  check('next block is "block-enrichment"', next?.blockId === "block-enrichment");

  const transitionState = getPresentationState(schedule, atLocalTime(MONDAY, "09:41"));
  if (transitionState.mode === "transition") {
    check(
      "transition state's nextStudentFacingBlock is Enrichment",
      transitionState.nextStudentFacingBlock?.blockId === "block-enrichment",
    );
  } else {
    check("transition state's nextStudentFacingBlock is Enrichment", false);
  }
}

async function verifyDataRepository() {
  console.log("\n7. DataRepository abstraction (LocalStorageDataRepository)");

  // Node has no `window` - simulate one so the repository's real
  // save/load code path (not just its demo-fallback branch) is exercised.
  const fakeStore = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => fakeStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        fakeStore.set(key, value);
      },
      removeItem: (key: string) => {
        fakeStore.delete(key);
      },
    },
  };

  const repo = new LocalStorageDataRepository();

  const firstLoad = await repo.load();
  check("first launch falls back to demo seed data", firstLoad.schedules.length > 0);

  const mutated = { ...createDemoAppData(), courses: [] };
  await repo.save(mutated);
  const reloaded = await repo.load();
  check("save() then load() round-trips through storage", reloaded.courses.length === 0);

  delete (globalThis as Record<string, unknown>).window;
}

verifyDataRepository().then(() => {
  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
});
