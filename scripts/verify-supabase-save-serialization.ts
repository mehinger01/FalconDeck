/**
 * Regression test for the SupabaseDataRepository.save() stale-write race
 * found during the Stage C+D authenticated smoke test: AppDataProvider's
 * save effect (lib/store/AppDataProvider.tsx) fires a new `repository.save(data)`
 * on every AppData change with no serialization of its own, so overlapping
 * calls could previously read the same stale `lastSnapshot`, each diff
 * correctly against it, and then race each other's Supabase upserts for
 * the SAME row - whichever write happened to resolve last won, regardless
 * of which call was dispatched last. Reproduced live in the browser
 * (typing into the Warm-Up field lost all but the first few characters,
 * non-deterministically across runs) and offline (repro-save-race.mjs,
 * scratch-only, superseded by this script).
 *
 * This exercises the real `SupabaseDataRepository` class and its real
 * `applyDiff`, against a minimal in-memory fake Supabase client - no
 * network, no real project touched. Only the `lessons`/`lesson_class_sections`
 * upsert path is driven with configurable artificial delay/failure (exactly
 * the two tables the observed bug wrote to); every other table's read
 * resolves instantly with an empty/default result, matching a brand-new
 * org with nothing else in it.
 *
 * Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:supabase-save-serialization
 */

import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import type { AppData } from "@/lib/data/types";
import type { DailyLesson } from "@/types/lesson";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Minimal fake Supabase client
// ---------------------------------------------------------------------------

const SINGLETON_TABLES = new Set(["classroom_experience_settings", "teacher_schedule_preferences"]);

interface WriteRecord {
  table: string;
  op: "upsert" | "delete";
  payload: unknown;
  resolvedAtMs: number;
}

interface FakeClientOptions {
  /** Delay (ms) before an upsert/delete on this table resolves. */
  writeDelayMs: (table: string, payload: unknown) => number;
  /** Whether this write call should resolve as a Supabase error instead of success. */
  shouldFailWrite: (table: string, payload: unknown, writeCallIndex: number) => boolean;
  onWrite: (record: WriteRecord) => void;
}

/**
 * Builds a fake `client.from(table)...` chain matching just enough of
 * supabase-js's shape for `fetchAppData`/`applyDiff` to run against: every
 * chain method (`select`/`eq`/`order`/`maybeSingle`) is a no-op returning
 * the same thenable builder; the builder resolves itself (acting as the
 * awaited Promise) once a terminal op (`select`'s implicit read, `upsert`,
 * `delete`) is reached.
 */
function createFakeClient(opts: FakeClientOptions) {
  let writeCallIndex = 0;

  function from(table: string) {
    let op: "select" | "upsert" | "delete" = "select";
    let payload: unknown = null;

    const builder = {
      select() {
        op = "select";
        return builder;
      },
      eq() {
        return builder;
      },
      order() {
        return builder;
      },
      maybeSingle() {
        return builder;
      },
      upsert(rows: unknown) {
        op = "upsert";
        payload = rows;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      then(onFulfilled: (v: { data: unknown; error: { message: string } | null }) => unknown, onRejected?: (e: unknown) => unknown) {
        const run = async () => {
          if (op === "select") {
            return { data: SINGLETON_TABLES.has(table) ? null : [], error: null };
          }
          const callIndex = writeCallIndex++;
          const delay = opts.writeDelayMs(table, payload);
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (opts.shouldFailWrite(table, payload, callIndex)) {
            return { data: null, error: { message: `simulated failure writing ${table}` } };
          }
          opts.onWrite({ table, op, payload, resolvedAtMs: Date.now() });
          return { data: payload, error: null };
        };
        return run().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return { from } as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0];
}

// ---------------------------------------------------------------------------
// AppData fixture helpers
// ---------------------------------------------------------------------------

const CTX = { organizationId: "org-test", membershipId: "membership-test" };
const SECTION_ID = "section-test";
const DATE = "2026-09-30";
const LESSON_ID = "lesson-test";

function blankAppData(): AppData {
  return {
    courses: [],
    classSections: [{ id: SECTION_ID, courseId: "course-test", name: "Test Section" }],
    schedules: [],
    lessons: [],
    classPresentationSettings: [],
    classroomExperienceSettings: {
      finalFiveMessage: "",
      showEndOfDayScreen: true,
      endOfDayMessage: "",
      cleanScreenDefaultMessage: "",
      showClockOnCleanScreen: true,
      transitionCountdownEnabled: true,
      transitionArrivalInstructionsEnabled: true,
    },
    libraryResources: [],
    teacherSchedulePreferences: { lunchWave: "none", activeBellScheduleId: null },
    schoolCalendar: null,
    teacherPeriodAssignments: [],
    transitionOverrides: [],
  } as unknown as AppData;
}

/** One AppData snapshot with a single lesson's warmup set to `warmup`. */
function snapshotWithWarmup(base: AppData, warmup: string): AppData {
  const lesson: DailyLesson = {
    id: LESSON_ID,
    date: DATE,
    classSectionId: SECTION_ID,
    learningTarget: "",
    agendaItems: [],
    resources: [],
    announcements: [],
    materials: undefined,
    warmup,
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
  } as DailyLesson;
  return { ...base, lessons: [lesson] };
}

function warmupOf(record: WriteRecord): string | undefined {
  if (record.table !== "lessons") return undefined;
  const rows = record.payload as Array<{ warmup?: string | null }>;
  return rows[0]?.warmup ?? undefined;
}

// ---------------------------------------------------------------------------
// TEST 1 - ordered rapid saves, reversed network delay
// ---------------------------------------------------------------------------
async function test1() {
  console.log("\n1. Ordered rapid saves (\"S\" -> \"So\" -> \"Sol\" -> \"Solv\"), earlier saves artificially slower");

  const writes: WriteRecord[] = [];
  const base = blankAppData();
  const client = createFakeClient({
    // Dispatched 1st..4th; delay DECREASES so earlier calls would resolve
    // LAST if the old (unserialized) code were still in place.
    writeDelayMs: (table) => (table === "lessons" ? [40, 30, 20, 10][writes.length] ?? 10 : 0),
    shouldFailWrite: () => false,
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);

  const keystrokes = ["S", "So", "Sol", "Solv"];
  const results = await Promise.all(keystrokes.map((text) => repo.save(snapshotWithWarmup(base, text))));

  check("all 4 saves reported ok:true", results.every((r) => r.ok));

  const lessonsWrites = writes.filter((w) => w.table === "lessons");
  check("exactly 4 'lessons' upserts occurred (one per save call, no coalescing)", lessonsWrites.length === 4);
  check(
    "writes landed in DISPATCH order, not artificial-delay order: " + lessonsWrites.map(warmupOf).join(" -> "),
    JSON.stringify(lessonsWrites.map(warmupOf)) === JSON.stringify(keystrokes),
  );

  const finalWarmup = warmupOf(lessonsWrites[lessonsWrites.length - 1]!);
  check(`final persisted warmup is "Solv" (got ${JSON.stringify(finalWarmup)})`, finalWarmup === "Solv");
}

// ---------------------------------------------------------------------------
// TEST 2 - many rapid saves (20), reversed/scrambled delay
// ---------------------------------------------------------------------------
async function test2() {
  console.log("\n2. 20 rapid sequential saves, scrambled artificial network delay");

  const writes: WriteRecord[] = [];
  const base = blankAppData();
  const N = 20;
  // Delay pattern deliberately NOT monotonic (scrambled), so neither "first
  // resolves first" nor "first resolves last" would accidentally mask a bug.
  const delayFor = (callIndex: number) => [5, 37, 12, 29, 3, 44, 18, 9, 33, 21][callIndex % 10];

  const client = createFakeClient({
    writeDelayMs: () => delayFor(writes.length),
    shouldFailWrite: () => false,
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);

  const snapshots = Array.from({ length: N }, (_, i) => `snapshot-${i + 1}`);
  const results = await Promise.all(snapshots.map((text) => repo.save(snapshotWithWarmup(base, text))));

  check(`all ${N} saves reported ok:true`, results.every((r) => r.ok));
  const lessonsWrites = writes.filter((w) => w.table === "lessons");
  check(`exactly ${N} 'lessons' upserts occurred`, lessonsWrites.length === N);
  check(
    "writes landed in exact dispatch order across all 20 calls",
    JSON.stringify(lessonsWrites.map(warmupOf)) === JSON.stringify(snapshots),
  );
  const finalWarmup = warmupOf(lessonsWrites[lessonsWrites.length - 1]!);
  check(`final persisted state equals snapshot 20 (got ${JSON.stringify(finalWarmup)})`, finalWarmup === "snapshot-20");
}

// ---------------------------------------------------------------------------
// TEST 3 - failure recovery: A, B, C queued; B fails; C must still run
// ---------------------------------------------------------------------------
async function test3() {
  console.log("\n3. Failure recovery: queue A, B, C; force B to fail; C must still run and the queue must not be poisoned");

  const writes: WriteRecord[] = [];
  const base = blankAppData();
  let lessonsWriteAttempt = 0;

  const client = createFakeClient({
    writeDelayMs: () => 10,
    shouldFailWrite: (table) => {
      if (table !== "lessons") return false;
      lessonsWriteAttempt += 1;
      return lessonsWriteAttempt === 2; // the 2nd lessons upsert attempt (save B) fails
    },
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);

  const [resultA, resultB, resultC] = await Promise.all([
    repo.save(snapshotWithWarmup(base, "A")),
    repo.save(snapshotWithWarmup(base, "B")),
    repo.save(snapshotWithWarmup(base, "C")),
  ]);

  check("save A resolved ok:true", resultA.ok === true);
  check(
  `save B resolved ok:false, with its original error message surfaced, not swallowed (got ${JSON.stringify(
    resultB.ok === false ? resultB.message : undefined,
  )})`,
  resultB.ok === false &&
    resultB.message.includes("simulated failure writing lessons"),
);
  check("save C (queued after the failing B) still ran and resolved ok:true", resultC.ok === true);

  const lessonsWrites = writes.filter((w) => w.table === "lessons");
  check(
    "exactly 2 successful 'lessons' writes landed (A and C; B's failed attempt wrote nothing)",
    lessonsWrites.length === 2 && warmupOf(lessonsWrites[0]!) === "A" && warmupOf(lessonsWrites[1]!) === "C",
  );

  // Queue not poisoned: a follow-up save after the failure must still succeed.
  const resultD = await repo.save(snapshotWithWarmup(base, "D"));
  check("a further save() after the failure still succeeds (queue is not permanently blocked)", resultD.ok === true);
}

// ---------------------------------------------------------------------------
// TEST 4 - lastSnapshot correctness, verified through observable behavior
// (no reaching into repository private state, per spec).
// ---------------------------------------------------------------------------
async function test4() {
  console.log("\n4. lastSnapshot correctness after successful queued saves (observed via diff/write behavior, not private state)");

  const writes: WriteRecord[] = [];
  const base = blankAppData();
  const client = createFakeClient({
    writeDelayMs: () => 5,
    shouldFailWrite: () => false,
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);

  await Promise.all(["one", "two", "three"].map((text) => repo.save(snapshotWithWarmup(base, text))));
  const writesAfterInitialBatch = writes.filter((w) => w.table === "lessons").length;
  check("3 writes landed from the initial batch", writesAfterInitialBatch === 3);

  // If `lastSnapshot` correctly reflects the last successfully persisted
  // state ("three"), re-saving that EXACT same AppData must produce NO new
  // write at all - diffById() sees no change. If `lastSnapshot` had instead
  // been left stale/incorrect by the serialization, this would wrongly
  // diff against an old value and fire a redundant (or wrong) write.
  const noopResult = await repo.save(snapshotWithWarmup(base, "three"));
  check("re-saving the identical already-persisted state resolves ok:true", noopResult.ok === true);
  const writesAfterNoop = writes.filter((w) => w.table === "lessons").length;
  check(
    "re-saving identical data produced NO additional write - proves lastSnapshot matches the newest persisted state",
    writesAfterNoop === writesAfterInitialBatch,
  );

  // And a real follow-up change is still correctly detected and written.
  await repo.save(snapshotWithWarmup(base, "four"));
  const writesAfterRealChange = writes.filter((w) => w.table === "lessons").length;
  check(
    "a genuine follow-up change still produces exactly one additional write",
    writesAfterRealChange === writesAfterInitialBatch + 1,
  );
  const lastWrite = writes.filter((w) => w.table === "lessons").pop()!;
  check(`that write carries the new value ("four")`, warmupOf(lastWrite) === "four");
}

// ---------------------------------------------------------------------------
// TEST 5 - PARTIAL applyDiff failure: a save's `lessons` upsert succeeds but
// its later `lesson_class_sections` upsert fails within the SAME applyDiff
// call. Split into two sub-scenarios so each claim is observable in
// isolation rather than conflated:
//
//   5a: proves B's partial failure does NOT advance `lastSnapshot` - tested
//       standalone (no C involved yet), since after C itself later succeeds
//       `lastSnapshot` would equal C's state regardless of what happened to
//       B, which would otherwise mask this specific claim.
//   5b: the full concurrent scenario as specified - A succeeds, B is
//       dispatched and partially fails, C is already queued behind B, C
//       still runs and converges the persisted lesson to C's value, a
//       post-C no-op proves `lastSnapshot` now reflects C, and a later D
//       save still succeeds normally.
// ---------------------------------------------------------------------------
async function test5() {
  console.log("\n5. Partial applyDiff failure (lessons upsert succeeds, lesson_class_sections upsert fails)");

  // --- 5a: isolation proof that a partially-failed save does not advance lastSnapshot ---
  {
    const writes: WriteRecord[] = [];
    const base = blankAppData();
    let lessonClassSectionsAttempt = 0;
    const client = createFakeClient({
      writeDelayMs: () => 5,
      shouldFailWrite: (table) => {
        if (table !== "lesson_class_sections") return false;
        lessonClassSectionsAttempt += 1;
        return lessonClassSectionsAttempt === 2; // B's lesson_class_sections write (A's succeeds first)
      },
      onWrite: (r) => writes.push(r),
    });
    const repo = new SupabaseDataRepository(client, CTX);

    const resultA = await repo.save(snapshotWithWarmup(base, "A"));
    check("5a. save A resolved ok:true", resultA.ok === true);

    const resultB = await repo.save(snapshotWithWarmup(base, "B"));
    check(
      `5a. save B resolved ok:false, with the simulated lesson_class_sections failure preserved (got ${JSON.stringify(
        resultB.ok === false ? resultB.message : undefined,
      )})`,
      resultB.ok === false && resultB.message.includes("simulated failure writing lesson_class_sections"),
    );

    const lessonsWritesSoFar = writes.filter((w) => w.table === "lessons").length;
    check(
      "5a. B's lessons upsert DID succeed before its lesson_class_sections upsert failed (partial write)",
      lessonsWritesSoFar === 2, // A's lessons write + B's lessons write
    );
    const lessonClassSectionsWritesSoFar = writes.filter((w) => w.table === "lesson_class_sections").length;
    check(
      "5a. B's lesson_class_sections upsert did NOT land (it's the one that failed)",
      lessonClassSectionsWritesSoFar === 1, // only A's succeeded
    );

    // If lastSnapshot correctly stayed at A (B's failure never advanced it),
    // re-saving A's EXACT original data is a no-op diff - no new writes at
    // all. If B had incorrectly advanced lastSnapshot to its own attempted
    // state, this would see a difference (A's value is different from B's
    // attempted value) and wrongly fire a write.
    const probeResult = await repo.save(snapshotWithWarmup(base, "A"));
    check("5a. probe re-save of A's original data resolves ok:true", probeResult.ok === true);
    const lessonsWritesAfterProbe = writes.filter((w) => w.table === "lessons").length;
    check(
      "5a. probe produced NO additional lessons write - proves B's partial failure did not advance lastSnapshot",
      lessonsWritesAfterProbe === lessonsWritesSoFar,
    );
  }

  // --- 5b: full concurrent scenario - A succeeds, B partially fails, C already queued behind B ---
  {
    const writes: WriteRecord[] = [];
    const base = blankAppData();
    let lessonClassSectionsAttempt = 0;
    const client = createFakeClient({
      writeDelayMs: () => 5,
      shouldFailWrite: (table) => {
        if (table !== "lesson_class_sections") return false;
        lessonClassSectionsAttempt += 1;
        return lessonClassSectionsAttempt === 2; // B's lesson_class_sections write
      },
      onWrite: (r) => writes.push(r),
    });
    const repo = new SupabaseDataRepository(client, CTX);

    const resultA = await repo.save(snapshotWithWarmup(base, "A"));
    check("5b. save A resolved ok:true", resultA.ok === true);

    // B and C dispatched together, without awaiting between them - C is
    // already queued behind B exactly as specified.
    const [resultB, resultC] = await Promise.all([
      repo.save(snapshotWithWarmup(base, "B")),
      repo.save(snapshotWithWarmup(base, "C")),
    ]);

    check(
      `5b. save B resolved ok:false, with the simulated lesson_class_sections failure preserved (got ${JSON.stringify(
        resultB.ok === false ? resultB.message : undefined,
      )})`,
      resultB.ok === false && resultB.message.includes("simulated failure writing lesson_class_sections"),
    );
    check("5b. save C (queued behind the partially-failing B) still ran and resolved ok:true", resultC.ok === true);
    check("5b. the queue is not poisoned: C executing at all proves this", resultC.ok === true);

    const lessonsWrites = writes.filter((w) => w.table === "lessons");
    const finalWarmup = warmupOf(lessonsWrites[lessonsWrites.length - 1]!);
    check(
      `5b. final persisted lesson state converges to C's value even though B partially wrote first (got ${JSON.stringify(finalWarmup)})`,
      finalWarmup === "C",
    );

    const writesBeforeNoop = writes.filter((w) => w.table === "lessons").length;
    const noopResult = await repo.save(snapshotWithWarmup(base, "C"));
    check("5b. re-saving C's exact snapshot after C succeeded resolves ok:true", noopResult.ok === true);
    const writesAfterNoop = writes.filter((w) => w.table === "lessons").length;
    check(
      "5b. re-saving C's exact snapshot produced NO additional lessons write - lastSnapshot now reflects C",
      writesAfterNoop === writesBeforeNoop,
    );

    const resultD = await repo.save(snapshotWithWarmup(base, "D"));
    check("5b. a later save D still succeeds normally", resultD.ok === true);
    const lastWrite = writes.filter((w) => w.table === "lessons").pop()!;
    check(`5b. save D's write carries its own value ("D")`, warmupOf(lastWrite) === "D");
  }
}

async function main() {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
