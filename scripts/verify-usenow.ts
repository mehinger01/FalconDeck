/**
 * Standalone verification for the `useNow` visibility/focus resync fix,
 * without modifying `lib/hooks/useNow.ts` or executing it through a React
 * renderer (no jsdom/react-test-renderer in this project, and none should
 * be added just for this).
 *
 * Two halves:
 *
 *   1. Dynamic - exercises the REAL schedule engine (`getPresentationState`)
 *      to confirm that because it is a pure function of `(schedule, now)`,
 *      a single resync call after any hidden duration - same period, across
 *      a period boundary, or landing inside a passing block - always
 *      resolves directly to the correct current state. This is the
 *      property `useNow`'s resync relies on: it does not replay missed
 *      ticks, it just forces one fresh recompute from `Date.now()`.
 *
 *   2. Static - reads `lib/hooks/useNow.ts` as text and asserts its
 *      subscribe/cleanup structure directly: one interval, one
 *      visibilitychange listener, one focus listener, the SAME handler
 *      wired to both (so focus and visibilitychange are provably
 *      equivalent), a stable `useCallback` dependency array (no
 *      re-subscription churn across renders), and a cleanup closure that
 *      tears down all three.
 *
 * Not a test framework - just a script with assertions, run via `tsx`,
 * matching the existing scripts/verify-*.ts convention:
 *
 *   npx tsx scripts/verify-usenow.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { DEMO_SCHEDULES } from "@/lib/data/demoData";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

// Fixed 2026 Monday, both EDT, no DST edge - same fixture date convention
// as scripts/verify-schedule.ts.
const MONDAY = "2026-08-17";

function atLocalTime(isoDate: string, hhmm: string): Date {
  return new Date(`${isoDate}T${hhmm}:00-04:00`);
}

const schedule = DEMO_SCHEDULES.find((s) => s.id === "schedule-demo-standard")!;

// Schedule-demo-standard Monday blocks (from lib/data/demoData.ts):
//   Period 2:        08:49-09:39  instructional
//   Passing Period:  09:39-09:44  passing
//   Enrichment:      09:48-10:08  enrichment
//   Period 4:        10:12-11:02  instructional

console.log("1. Same-period resume: two reads within one block agree");
{
  const beforeHide = getPresentationState(schedule, atLocalTime(MONDAY, "09:00"));
  const afterResume = getPresentationState(schedule, atLocalTime(MONDAY, "09:15"));
  check('both reads are mode "student-facing"', beforeHide.mode === "student-facing" && afterResume.mode === "student-facing");
  if (beforeHide.mode === "student-facing" && afterResume.mode === "student-facing") {
    check("both resolve to the same block (Period 2)", beforeHide.block.blockId === afterResume.block.blockId);
  }
}

console.log("\n2. Resume across a period transition jumps directly to the current period");
{
  // Hidden while in Period 2, resumes well into Period 4 - skipping the
  // Passing Period and all of Enrichment entirely, exactly like a tab
  // backgrounded across a full period change.
  const beforeHide = getPresentationState(schedule, atLocalTime(MONDAY, "09:00"));
  const afterResume = getPresentationState(schedule, atLocalTime(MONDAY, "10:20"));
  check('pre-hide state is Period 2', beforeHide.mode === "student-facing" && beforeHide.block.label === "Period 2");
  check('post-resume state is mode "student-facing"', afterResume.mode === "student-facing");
  if (afterResume.mode === "student-facing") {
    check('post-resume block is "Period 4" directly (not Period 2, Passing, or Enrichment)', afterResume.block.label === "Period 4");
  }
}

console.log("\n3. Resume landing inside a passing/transition block resolves correctly");
{
  // Hidden at the tail of Period 2, resumes inside the Passing Period.
  const afterResume = getPresentationState(schedule, atLocalTime(MONDAY, "09:41"));
  check('resolves to mode "transition"', afterResume.mode === "transition");
  if (afterResume.mode === "transition") {
    check(
      "nextStudentFacingBlock is Enrichment (not skipped, not stale from Period 2)",
      afterResume.nextStudentFacingBlock?.blockId === "block-enrichment",
    );
  }
}

console.log("\n4. getPresentationState is a pure function of (schedule, now)");
{
  // No memoization/hidden state across calls - required for "one resync
  // call after an arbitrary hidden duration" to be correct at all. Calling
  // it out of chronological order must not affect the result.
  const forward = getPresentationState(schedule, atLocalTime(MONDAY, "10:20"));
  const backwardsFirst = getPresentationState(schedule, atLocalTime(MONDAY, "08:49"));
  const forwardAgain = getPresentationState(schedule, atLocalTime(MONDAY, "10:20"));
  check(
    "repeated/out-of-order calls for the same timestamp are identical",
    JSON.stringify(forward) === JSON.stringify(forwardAgain),
  );
  check("earlier call does not leak into a later independent call", backwardsFirst.mode === "student-facing");
}

console.log("\n5. Static structure of lib/hooks/useNow.ts (read-only, not executed)");
{
  const source = readFileSync(join(process.cwd(), "lib/hooks/useNow.ts"), "utf8");

  const countOccurrences = (re: RegExp) => (source.match(re) ?? []).length;

  check("exactly one setInterval(...) registration", countOccurrences(/\bsetInterval\(/g) === 1);
  check("exactly one clearInterval(...) call", countOccurrences(/\bclearInterval\(/g) === 1);
  check(
    'exactly one document.addEventListener("visibilitychange", ...)',
    countOccurrences(/document\.addEventListener\(\s*["']visibilitychange["']/g) === 1,
  );
  check(
    'exactly one document.removeEventListener("visibilitychange", ...)',
    countOccurrences(/document\.removeEventListener\(\s*["']visibilitychange["']/g) === 1,
  );
  check(
    'exactly one window.addEventListener("focus", ...)',
    countOccurrences(/window\.addEventListener\(\s*["']focus["']/g) === 1,
  );
  check(
    'exactly one window.removeEventListener("focus", ...)',
    countOccurrences(/window\.removeEventListener\(\s*["']focus["']/g) === 1,
  );

  const addVisibility = source.match(/document\.addEventListener\(\s*["']visibilitychange["']\s*,\s*(\w+)/);
  const addFocus = source.match(/window\.addEventListener\(\s*["']focus["']\s*,\s*(\w+)/);
  const removeVisibility = source.match(/document\.removeEventListener\(\s*["']visibilitychange["']\s*,\s*(\w+)/);
  const removeFocus = source.match(/window\.removeEventListener\(\s*["']focus["']\s*,\s*(\w+)/);
  check("visibilitychange and focus are wired to the SAME handler (proves focus is behaviorally identical to visibilitychange)", !!addVisibility && !!addFocus && addVisibility[1] === addFocus[1]);
  check("removeEventListener calls target that same handler identifier (cleanup actually detaches what was attached, not a look-alike)", !!removeVisibility && !!removeFocus && addVisibility?.[1] === removeVisibility[1] && addFocus?.[1] === removeFocus[1]);

  check(
    'useCallback dependency array is exactly "[intervalMs]" (stable subscribe identity - no re-subscription churn across renders with the same intervalMs, so no duplicate interval/listener registration)',
    /useCallback\(\s*[\s\S]*?,\s*\[intervalMs\]\s*,?\s*\)/.test(source),
  );

  // The returned cleanup closure must contain all three teardown calls -
  // confirm they appear after the subscribe function's `return (` marker,
  // i.e. inside the actual unsubscribe closure and not dead code elsewhere.
  const returnIndex = source.indexOf("return () => {");
  check("subscribe function has a `return () => { ... }` cleanup closure", returnIndex !== -1);
  const cleanupBody = returnIndex !== -1 ? source.slice(returnIndex) : "";
  check("cleanup closure clears the interval", /clearInterval\(/.test(cleanupBody));
  check("cleanup closure removes the visibilitychange listener", /document\.removeEventListener\(\s*["']visibilitychange["']/.test(cleanupBody));
  check("cleanup closure removes the focus listener", /window\.removeEventListener\(\s*["']focus["']/.test(cleanupBody));

  const resyncGuard = source.match(/const\s+resync\s*=\s*\(\)\s*=>\s*\{\s*if\s*\(document\.visibilityState\s*===\s*["']visible["']\)\s*(\w+)\(\);?\s*\};/);
  check(
    "resync only fires onStoreChange when document.visibilityState is visible (no spurious recompute while still hidden)",
    !!resyncGuard,
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
