/**
 * Standalone verification for the `useNow` visibility/focus resync fix,
 * without executing it through a React renderer (no jsdom/react-test-
 * renderer in this project, and none should be added just for this).
 *
 * Two halves:
 *
 *   1. Dynamic - exercises the REAL schedule engine (`getPresentationState`)
 *      to confirm that because it is a pure function of `(schedule, now)`,
 *      a single resync call after any hidden duration - same period, across
 *      a period boundary, or landing inside a passing block - always
 *      resolves directly to the correct current state. This is the
 *      property `useNow`'s resync relies on: it does not replay missed
 *      ticks, it just forces one fresh recompute of the cached timestamp.
 *
 *   2. Static - reads `lib/hooks/clockStore.ts` as text and asserts its
 *      subscribe/cleanup structure directly: one interval, one
 *      visibilitychange listener, one focus listener, the SAME handler
 *      wired to both (so focus and visibilitychange are provably
 *      equivalent), and a cleanup closure that tears down all three.
 *      (The subscribe/getSnapshot caching behavior itself - the "Maximum
 *      update depth exceeded" regression - is exercised for real, not just
 *      read as text, in scripts/verify-clockstore.ts; `createClockStore`
 *      is pure and DOM-free specifically so that's possible without a
 *      renderer.)
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

console.log("\n5. Static structure of lib/hooks/clockStore.ts (read-only, not executed)");
{
  // `useNow.ts` itself is now a thin useSyncExternalStore wrapper around
  // `createClockStore` (see scripts/verify-clockstore.ts for the fix this
  // enabled) - the actual subscribe/interval/listener wiring these checks
  // pin now lives here instead.
  const source = readFileSync(join(process.cwd(), "lib/hooks/clockStore.ts"), "utf8");

  const countOccurrences = (re: RegExp) => (source.match(re) ?? []).length;

  check("exactly one deps.setInterval(...) registration", countOccurrences(/\bdeps\.setInterval\(/g) === 1);
  check("exactly one deps.clearInterval(...) call", countOccurrences(/\bdeps\.clearInterval\(/g) === 1);
  check(
    "exactly one deps.addVisibilityChangeListener(...) registration",
    countOccurrences(/\bdeps\.addVisibilityChangeListener\(/g) === 1,
  );
  check(
    "exactly one deps.removeVisibilityChangeListener(...) call",
    countOccurrences(/\bdeps\.removeVisibilityChangeListener\(/g) === 1,
  );
  check("exactly one deps.addFocusListener(...) registration", countOccurrences(/\bdeps\.addFocusListener\(/g) === 1);
  check("exactly one deps.removeFocusListener(...) call", countOccurrences(/\bdeps\.removeFocusListener\(/g) === 1);
  check(
    "exactly one deps.addPageShowListener(...) registration",
    countOccurrences(/\bdeps\.addPageShowListener\(/g) === 1,
  );
  check(
    "exactly one deps.removePageShowListener(...) call",
    countOccurrences(/\bdeps\.removePageShowListener\(/g) === 1,
  );

  const addVisibility = source.match(/deps\.addVisibilityChangeListener\(\s*(\w+)/);
  const addFocus = source.match(/deps\.addFocusListener\(\s*(\w+)/);
  const removeVisibility = source.match(/deps\.removeVisibilityChangeListener\(\s*(\w+)/);
  const removeFocus = source.match(/deps\.removeFocusListener\(\s*(\w+)/);
  check("visibilitychange and focus are wired to the SAME handler (proves focus is behaviorally identical to visibilitychange)", !!addVisibility && !!addFocus && addVisibility[1] === addFocus[1]);
  check("remove calls target that same handler identifier (cleanup actually detaches what was attached, not a look-alike)", !!removeVisibility && !!removeFocus && addVisibility?.[1] === removeVisibility[1] && addFocus?.[1] === removeFocus[1]);

  const addPageShow = source.match(/deps\.addPageShowListener\(\s*(\w+)/);
  const removePageShow = source.match(/deps\.removePageShowListener\(\s*(\w+)/);
  check(
    "pageshow is wired to tick directly, NOT the visibility-guarded resync (bfcache restoration must resync unconditionally)",
    addPageShow?.[1] === "tick",
  );
  check(
    "pageshow's remove call targets the same tick identifier",
    !!addPageShow && !!removePageShow && addPageShow[1] === removePageShow[1],
  );

  // The returned cleanup closure must contain all four teardown calls -
  // confirm they appear after subscribe's `return (` marker, i.e. inside
  // the actual unsubscribe closure and not dead code elsewhere.
  const returnIndex = source.indexOf("return () => {");
  check("subscribe function has a `return () => { ... }` cleanup closure", returnIndex !== -1);
  const cleanupBody = returnIndex !== -1 ? source.slice(returnIndex) : "";
  check("cleanup closure clears the interval", /deps\.clearInterval\(/.test(cleanupBody));
  check("cleanup closure removes the visibilitychange listener", /deps\.removeVisibilityChangeListener\(/.test(cleanupBody));
  check("cleanup closure removes the focus listener", /deps\.removeFocusListener\(/.test(cleanupBody));
  check("cleanup closure removes the pageshow listener", /deps\.removePageShowListener\(/.test(cleanupBody));

  const resyncGuard = source.match(/const\s+resync\s*=\s*\(\)\s*=>\s*\{\s*if\s*\(deps\.isVisible\(\)\)\s*(\w+)\(\);?\s*\};/);
  check(
    "resync only fires tick() when deps.isVisible() is true (no spurious recompute while still hidden)",
    !!resyncGuard,
  );

  check(
    "getSnapshot returns the cached variable, never a fresh deps.now() read (the exact bug this module fixes)",
    /function getSnapshot\(\): number \{\s*return cachedNow;\s*\}/.test(source),
  );
  check(
    "the cache is written only inside tick, immediately before notifying (cache-then-notify order, never notify-then-cache)",
    /const tick = \(\) => \{\s*cachedNow = deps\.now\(\);\s*onStoreChange\(\);\s*\};/.test(source),
  );
}

console.log("\n6. Static structure of lib/hooks/useNow.ts's real browser bindings (read-only, not executed)");
{
  // clockStore.ts is DOM-free by design (see section 5) - the actual
  // document/window bindings for those injected deps live here instead.
  const source = readFileSync(join(process.cwd(), "lib/hooks/useNow.ts"), "utf8");
  check(
    'browserClockDeps binds a real window.addEventListener("pageshow", ...)',
    /window\.addEventListener\(\s*["']pageshow["']/.test(source),
  );
  check(
    'browserClockDeps binds a real window.removeEventListener("pageshow", ...)',
    /window\.removeEventListener\(\s*["']pageshow["']/.test(source),
  );
  check(
    'browserClockDeps still binds visibilitychange/focus too',
    /document\.addEventListener\(\s*["']visibilitychange["']/.test(source) &&
      /window\.addEventListener\(\s*["']focus["']/.test(source),
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
