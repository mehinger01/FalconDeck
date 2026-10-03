/**
 * Regression test for SupabaseDataRepository's save-queue design.
 *
 * Covers two distinct fixes, both found during the Stage C+D authenticated
 * smoke test:
 *
 * 1. The original out-of-order stale-write race: AppDataProvider's save
 *    effect (lib/store/AppDataProvider.tsx) fires a new `repository.save(data)`
 *    on every AppData change with no serialization of its own, so
 *    overlapping calls could read the same stale `lastSnapshot`, each diff
 *    correctly against it, and then race each other's Supabase upserts for
 *    the SAME row - whichever write resolved last won, regardless of which
 *    call was dispatched last.
 *
 * 2. The resulting backlog problem: naively serializing every call (one
 *    critical section per save() call, strictly in order) is correct but
 *    means N rapid keystrokes queue N full network round trips - a long
 *    typed entry could take many seconds to fully persist, so a reload
 *    shortly after typing would show only however far the queue had
 *    gotten, even though no race occurred. The fix is repository-level
 *    coalescing: at most one critical section in flight, at most one
 *    replaceable "latest pending" snapshot absorbing everything that
 *    arrives while something is already running.
 *
 * A third property, required by the coalescing design itself: applyDiff()
 * is not atomic (it's a sequence of independent upserts/deletes), so a
 * failure partway through may have already partially written the database.
 * The cached baseline (`lastSnapshot`) is therefore invalidated on ANY
 * failure, forcing the next critical section to re-fetch real cloud state
 * rather than diff against a baseline that might already be wrong.
 *
 * This exercises the real `SupabaseDataRepository` class and its real
 * `applyDiff`, against a STATEFUL in-memory fake Supabase client - no
 * network, no real project touched. The fake client maintains actual
 * per-table row state (not just a write log), which TEST E specifically
 * requires: it must be possible to observe that a database row already
 * reflects a failed save's partial write, and that a later save's re-fetch
 * genuinely sees that real state rather than a cached assumption.
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
// Stateful fake Supabase client
// ---------------------------------------------------------------------------

const SINGLETON_TABLES = new Set(["classroom_experience_settings", "teacher_schedule_preferences"]);

interface WriteRecord {
  table: string;
  op: "upsert" | "delete";
  payload: unknown;
  resolvedAtMs: number;
}

/** The real schema's upsert conflict target per table - lesson_class_sections has no own `id`. */
function upsertKeyFor(table: string): string {
  return table === "lesson_class_sections" ? "lesson_id" : "id";
}

interface FakeClientOptions {
  /** Delay (ms) before an upsert/delete resolves. */
  writeDelayMs: () => number;
  /** Whether this write call should resolve as a Supabase error instead of succeeding. */
  shouldFailWrite: (table: string, op: "upsert" | "delete", payload: unknown, writeCallIndex: number) => boolean;
  onWrite: (record: WriteRecord) => void;
}

/**
 * Builds a fake `client.from(table)...` chain matching just enough of
 * supabase-js's shape for `fetchAppData`/`applyDiff` to run against, PLUS
 * an actual in-memory `db` (table -> rows) that upserts/deletes genuinely
 * mutate and selects genuinely read from - required so a save that
 * re-fetches after a failure observes real (possibly partially-written)
 * state, not a hardcoded default.
 */
function createFakeClient(opts: FakeClientOptions) {
  const db: Record<string, Array<Record<string, unknown>>> = {};
  let writeCallIndex = 0;

  function from(table: string) {
    let op: "select" | "upsert" | "delete" = "select";
    let payload: unknown = null;
    const eqFilters: Array<[string, unknown]> = [];

    const builder = {
      select() {
        op = "select";
        return builder;
      },
      eq(column: string, value: unknown) {
        eqFilters.push([column, value]);
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
      then(
        onFulfilled: (v: { data: unknown; error: { message: string } | null }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) {
        const run = async () => {
          if (op === "select") {
            const rows = db[table] ?? [];
            const filtered = rows.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
            return { data: SINGLETON_TABLES.has(table) ? (filtered[0] ?? null) : filtered, error: null };
          }
          const callIndex = writeCallIndex++;
          await new Promise((resolve) => setTimeout(resolve, opts.writeDelayMs()));
          if (opts.shouldFailWrite(table, op, payload, callIndex)) {
            return { data: null, error: { message: `simulated failure writing ${table}` } };
          }
          if (op === "upsert") {
            const key = upsertKeyFor(table);
            const existing = db[table] ?? (db[table] = []);
            const rowsToUpsert = (Array.isArray(payload) ? payload : [payload]) as Array<Record<string, unknown>>;
            for (const row of rowsToUpsert) {
              const idx = existing.findIndex((r) => r[key] === row[key]);
              if (idx === -1) existing.push(row);
              else existing[idx] = row;
            }
          } else {
            const existing = db[table] ?? [];
            db[table] = existing.filter((r) => !eqFilters.every(([c, v]) => r[c] === v));
          }
          opts.onWrite({ table, op, payload, resolvedAtMs: Date.now() });
          return { data: payload, error: null };
        };
        return run().then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return {
    client: { from } as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0],
    db,
  };
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
// TEST A - burst coalescing: ~100 rapid saves collapse into far fewer writes
// ---------------------------------------------------------------------------
async function testA() {
  console.log("\nA. Burst coalescing: 100 rapid save() calls collapse into far fewer actual writes");

  const writes: WriteRecord[] = [];
  const { client, db } = createFakeClient({
    writeDelayMs: () => 20,
    shouldFailWrite: () => false,
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);
  const base = blankAppData();
  const N = 100;
  const snapshots = Array.from({ length: N }, (_, i) => `k${i + 1}`);

  const t0 = Date.now();
  const results = await Promise.all(snapshots.map((text) => repo.save(snapshotWithWarmup(base, text))));
  const elapsedMs = Date.now() - t0;

  check("all 100 save() calls resolved ok:true", results.every((r) => r.ok));

  const lessonsWrites = writes.filter((w) => w.table === "lessons");
  const writtenValues = lessonsWrites.map(warmupOf);
  check(
    `exactly 2 actual 'lessons' writes occurred for 100 overlapping calls: the one already running when the burst ` +
      `started ("k1"), plus one representing the coalesced latest snapshot ("k100") - got ${JSON.stringify(writtenValues)}`,
    JSON.stringify(writtenValues) === JSON.stringify(["k1", "k100"]),
  );

  const lessonsRow = (db["lessons"] ?? []).find((r) => r.id === LESSON_ID);
  check(`final persisted value equals snapshot 100 (got ${JSON.stringify(lessonsRow?.warmup)})`, lessonsRow?.warmup === "k100");

  check(
    `total drain time is O(number of representative writes: 2), not O(100) - took ${elapsedMs}ms, well under the ` +
      `~4000ms+ that 100 sequential round trips at this delay would require`,
    elapsedMs < 1000,
  );
}

// ---------------------------------------------------------------------------
// TEST B - coalesced promise semantics
// ---------------------------------------------------------------------------
async function testB() {
  console.log("\nB. Coalesced promise semantics: A in flight, B arrives, C replaces B's position");

  const writes: WriteRecord[] = [];
  const { client } = createFakeClient({
    writeDelayMs: () => 15,
    shouldFailWrite: () => false,
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);
  const base = blankAppData();

  const [resultA, resultB, resultC] = await Promise.all([
    repo.save(snapshotWithWarmup(base, "A")),
    repo.save(snapshotWithWarmup(base, "B")),
    repo.save(snapshotWithWarmup(base, "C")),
  ]);

  check("A resolved ok:true", resultA.ok === true);
  check("B resolved ok:true", resultB.ok === true);
  check("C resolved ok:true", resultC.ok === true);

  const writtenValues = writes.filter((w) => w.table === "lessons").map(warmupOf);
  check(
    `exactly 2 lessons writes occurred: A, then C - B was never written (got ${JSON.stringify(writtenValues)})`,
    JSON.stringify(writtenValues) === JSON.stringify(["A", "C"]),
  );
  check("B and C resolve to the identical SaveResult (the one underlying C write)", JSON.stringify(resultB) === JSON.stringify(resultC));
}

// ---------------------------------------------------------------------------
// TEST C - in-flight failure + pending success
// ---------------------------------------------------------------------------
async function testC() {
  console.log("\nC. In-flight failure + pending success: A fails alone, B+C coalesce and succeed, re-fetching real state first");

  const writes: WriteRecord[] = [];
  let lessonsAttempt = 0;
  const { client, db } = createFakeClient({
    writeDelayMs: () => 15,
    shouldFailWrite: (table) => {
      if (table !== "lessons") return false;
      lessonsAttempt += 1;
      return lessonsAttempt === 1; // A's own lessons upsert fails
    },
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);
  const base = blankAppData();

  const [resultA, resultB, resultC] = await Promise.all([
    repo.save(snapshotWithWarmup(base, "A")),
    repo.save(snapshotWithWarmup(base, "B")),
    repo.save(snapshotWithWarmup(base, "C")),
  ]);

  check("A resolved ok:false", resultA.ok === false);
  check("B resolved ok:true", resultB.ok === true);
  check("C resolved ok:true", resultC.ok === true);
  check("B and C resolve to the identical ok:true SaveResult", JSON.stringify(resultB) === JSON.stringify(resultC));

  const lessonsRow = (db["lessons"] ?? []).find((r) => r.id === LESSON_ID);
  check(`final persisted value is C (got ${JSON.stringify(lessonsRow?.warmup)})`, lessonsRow?.warmup === "C");

  const writesBeforeNoop = writes.filter((w) => w.table === "lessons").length;
  const noop = await repo.save(snapshotWithWarmup(base, "C"));
  check("a further no-op resave of C resolves ok:true", noop.ok === true);
  const writesAfterNoop = writes.filter((w) => w.table === "lessons").length;
  check(
    "the no-op resave produced NO additional write - proves lastSnapshot correctly reflects C after the re-fetch",
    writesAfterNoop === writesBeforeNoop,
  );
}

// ---------------------------------------------------------------------------
// TEST D - representative pending failure
// ---------------------------------------------------------------------------
async function testD() {
  console.log("\nD. Representative pending failure: A succeeds, B+C coalesce, C's write fails; later D still succeeds and re-fetches");

  const writes: WriteRecord[] = [];
  let lcsAttempt = 0;
  const { client, db } = createFakeClient({
    writeDelayMs: () => 15,
    shouldFailWrite: (table) => {
      if (table !== "lesson_class_sections") return false;
      lcsAttempt += 1;
      return lcsAttempt === 2; // A's own lesson_class_sections succeeds (1st); C's (promoted) fails (2nd)
    },
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);
  const base = blankAppData();

  const [resultA, resultB, resultC] = await Promise.all([
    repo.save(snapshotWithWarmup(base, "A")),
    repo.save(snapshotWithWarmup(base, "B")),
    repo.save(snapshotWithWarmup(base, "C")),
  ]);

  check("A resolved ok:true", resultA.ok === true);
  check("B resolved ok:false", resultB.ok === false);
  check("C resolved ok:false", resultC.ok === false);
  check("B and C resolve to the identical ok:false SaveResult", JSON.stringify(resultB) === JSON.stringify(resultC));

  const resultD = await repo.save(snapshotWithWarmup(base, "D"));
  check("a later save D still succeeds (the queue is not poisoned)", resultD.ok === true);

  const lessonsRow = (db["lessons"] ?? []).find((r) => r.id === LESSON_ID);
  check(`final persisted value is D, correctly re-fetched after C's failure (got ${JSON.stringify(lessonsRow?.warmup)})`, lessonsRow?.warmup === "D");
}

// ---------------------------------------------------------------------------
// TEST E - REQUIRED partial-write counterexample
// ---------------------------------------------------------------------------
async function testE() {
  console.log(
    "\nE. REQUIRED partial-write counterexample: B's lessons write succeeds but lesson_class_sections fails; " +
      "C must re-fetch real state (observing B's partial 'new') and correct back to 'old'",
  );

  const writes: WriteRecord[] = [];
  let lcsAttempt = 0;
  const { client, db } = createFakeClient({
    writeDelayMs: () => 10,
    shouldFailWrite: (table) => {
      if (table !== "lesson_class_sections") return false;
      lcsAttempt += 1;
      return lcsAttempt === 2; // A's own lesson_class_sections succeeds (1st); B's fails (2nd)
    },
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);
  const base = blankAppData();

  const resultA = await repo.save(snapshotWithWarmup(base, "old"));
  check('A persists "old" successfully', resultA.ok === true);

  const resultB = await repo.save(snapshotWithWarmup(base, "new"));
  check("B (whose lesson_class_sections write fails) resolves ok:false", resultB.ok === false);

  const lessonsRowAfterB = (db["lessons"] ?? []).find((r) => r.id === LESSON_ID);
  check(
    `the fake DB's lessons row already reflects B's PARTIAL write ("new") despite B's overall failure ` +
      `(got ${JSON.stringify(lessonsRowAfterB?.warmup)}) - proving applyDiff is not atomic`,
    lessonsRowAfterB?.warmup === "new",
  );

  const resultC = await repo.save(snapshotWithWarmup(base, "old"));
  check('C (wanting "old" again) resolves ok:true', resultC.ok === true);

  const lessonsWrites = writes.filter((w) => w.table === "lessons");
  const writtenValues = lessonsWrites.map(warmupOf);
  check(
    `C issued a genuine corrective 'lessons' write - it did NOT incorrectly no-op against a stale cached baseline ` +
      `(write log: ${JSON.stringify(writtenValues)})`,
    JSON.stringify(writtenValues) === JSON.stringify(["old", "new", "old"]),
  );

  const lessonsRowFinal = (db["lessons"] ?? []).find((r) => r.id === LESSON_ID);
  check(`final fake DB state converges back to "old" (got ${JSON.stringify(lessonsRowFinal?.warmup)})`, lessonsRowFinal?.warmup === "old");
}

// ---------------------------------------------------------------------------
// TEST F - no-op after successful convergence
// ---------------------------------------------------------------------------
async function testF() {
  console.log("\nF. No-op after successful convergence: re-saving the identical already-persisted value produces no extra write");

  const writes: WriteRecord[] = [];
  const { client } = createFakeClient({
    writeDelayMs: () => 10,
    shouldFailWrite: () => false,
    onWrite: (r) => writes.push(r),
  });
  const repo = new SupabaseDataRepository(client, CTX);
  const base = blankAppData();

  await repo.save(snapshotWithWarmup(base, "final"));
  const writesBefore = writes.filter((w) => w.table === "lessons").length;

  const noop = await repo.save(snapshotWithWarmup(base, "final"));
  check("re-saving the identical value resolves ok:true", noop.ok === true);
  const writesAfter = writes.filter((w) => w.table === "lessons").length;
  check("no additional 'lessons' write occurred", writesAfter === writesBefore);
}

// ---------------------------------------------------------------------------
// TEST G - existing 2ba34d7 guarantees remain, under the new coalescing design
// ---------------------------------------------------------------------------
async function testG() {
  console.log("\nG. Re-confirming 2ba34d7's original guarantees still hold under the new coalescing design");

  // G1: no out-of-order stale writes - the newest dispatched value always wins.
  {
    const writes: WriteRecord[] = [];
    const { client, db } = createFakeClient({
      writeDelayMs: () => 15,
      shouldFailWrite: () => false,
      onWrite: (r) => writes.push(r),
    });
    const repo = new SupabaseDataRepository(client, CTX);
    const base = blankAppData();
    const keystrokes = ["S", "So", "Sol", "Solv"];
    const results = await Promise.all(keystrokes.map((t) => repo.save(snapshotWithWarmup(base, t))));
    check("G1. all saves resolved ok:true", results.every((r) => r.ok));
    const lessonsRow = (db["lessons"] ?? []).find((r) => r.id === LESSON_ID);
    check(
      `G1. final value is the last-dispatched one ("Solv"), never an earlier/stale value (got ${JSON.stringify(lessonsRow?.warmup)})`,
      lessonsRow?.warmup === "Solv",
    );
  }

  // G2: a failure does not poison later saves.
  {
    let attempt = 0;
    const { client } = createFakeClient({
      writeDelayMs: () => 5,
      shouldFailWrite: (table) => {
        if (table !== "lessons") return false;
        attempt += 1;
        return attempt === 1;
      },
      onWrite: () => {},
    });
    const repo = new SupabaseDataRepository(client, CTX);
    const base = blankAppData();
    const resultFail = await repo.save(snapshotWithWarmup(base, "fails"));
    check("G2. the first save fails as expected", resultFail.ok === false);
    const resultAfter = await repo.save(snapshotWithWarmup(base, "recovers"));
    check("G2. a later save still succeeds - the queue is not poisoned", resultAfter.ok === true);
  }

  // G3: simple lastSnapshot correctness for sequential, non-overlapping saves.
  {
    const writes: WriteRecord[] = [];
    const { client } = createFakeClient({
      writeDelayMs: () => 5,
      shouldFailWrite: () => false,
      onWrite: (r) => writes.push(r),
    });
    const repo = new SupabaseDataRepository(client, CTX);
    const base = blankAppData();
    await repo.save(snapshotWithWarmup(base, "one"));
    await repo.save(snapshotWithWarmup(base, "two"));
    const writesBefore = writes.filter((w) => w.table === "lessons").length;
    await repo.save(snapshotWithWarmup(base, "two")); // no-op
    const writesAfter = writes.filter((w) => w.table === "lessons").length;
    check("G3. sequential saves each land correctly and a final no-op produces nothing extra", writesAfter === writesBefore);
  }
}

async function main() {
  await testA();
  await testB();
  await testC();
  await testD();
  await testE();
  await testF();
  await testG();

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
