/**
 * Concurrency verification for save_setup_draft and complete_setup
 * (docs/ONBOARDING_SETUP_ARCHITECTURE.md §8) - genuinely overlapping
 * requests, each on its own connection, against a throwaway local
 * PostgreSQL 17 server (scripts/support/testDatabase.ts). Never touches the
 * linked Supabase project.
 *
 * HOW OVERLAP IS PROVEN, not assumed: the test takes the membership's
 * setup advisory lock itself on a separate connection, fires the requests,
 * and waits until pg_stat_activity shows every one of them blocked on that
 * lock. At that moment all N transactions are open at once and none has
 * read anything. Only then is the lock released. Sections 6 and 7 add
 * unsynchronized races with nothing held.
 *
 * What this still is not: PostgREST, Supabase's connection pooler, or
 * production hardware. See the architecture document's "pending" list.
 *
 *   npm run verify:onboarding-setup-concurrency
 */

import { deepEqual } from "@/lib/data/supabaseMapping";
import { SupabaseSetupRepository } from "@/lib/data/supabaseSetupRepository";
import { createEmptySetupDraft } from "@/lib/onboarding/setupDraft";
import type { CompleteSetupResult, SaveSetupDraftResult, SetupCallResult } from "@/lib/onboarding/setupRepository";
import { generateId } from "@/lib/store/id";
import type { SetupDraft } from "@/types/setupDraft";
import { createTestDatabase, type TestDatabase } from "./support/testDatabase";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const OVERLAP = 8;
let db: TestDatabase;

interface Teacher {
  userId: string;
  organizationId: string;
  membershipId: string;
  repository: SupabaseSetupRepository;
}

async function newFounder(label: string): Promise<Teacher> {
  const userId = await db.createUser(`${label}@example.test`);
  const client = db.clientFor(userId);
  const { error } = await client.rpc("bootstrap_organization", { organization_name: `${label} School` });
  if (error) throw new Error(`bootstrap_organization failed: ${error.message}`);
  const [row] = await db.admin<{ id: string; organization_id: string }>(
    "select id, organization_id from public.organization_memberships where user_id = $1",
    [userId],
  );
  return { userId, organizationId: row.organization_id, membershipId: row.id, repository: new SupabaseSetupRepository(client, row.organization_id) };
}

function completeDraft(lunchWave: SetupDraft["lunchWave"] = "none"): SetupDraft {
  const courseId = generateId("course");
  const sectionId = generateId("section");
  return {
    ...createEmptySetupDraft(),
    courses: [{ id: courseId, name: "Geometry" }],
    classSections: [{ id: sectionId, courseId, name: "Geometry - 1st Hour" }],
    schedule: {
      mode: "own",
      id: generateId("schedule"),
      name: "My Schedule",
      timeZone: "America/Detroit",
      blocks: [{ id: generateId("block"), label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: sectionId }],
    },
    lunchWave,
    firstLesson: { id: generateId("lesson"), date: "2026-10-12", classSectionId: sectionId, learningTarget: "I can.", agendaItems: [], resources: [], announcements: [] },
  };
}

/** Saves `draft` as a new draft and returns its operation id and revision. */
async function seedDraft(teacher: Teacher, draft: SetupDraft): Promise<{ operationId: string; revision: number }> {
  const result = await teacher.repository.saveDraft(null, draft);
  if (!result.ok || result.value.status !== "saved") throw new Error("could not seed a draft");
  return { operationId: result.value.operationId, revision: result.value.revision };
}

/** Takes the same advisory lock the setup functions take, on its own connection. Returns the release function. */
async function holdSetupLock(membershipId: string): Promise<() => Promise<void>> {
  const connection = await db.connect();
  await connection.query("begin");
  await connection.query("select pg_advisory_xact_lock(hashtextextended('onboarding_setup:' || $1::text, 0))", [membershipId]);
  return async () => {
    await connection.query("commit");
    connection.release();
  };
}

async function blockedSetupRequests(): Promise<number> {
  const [row] = await db.admin<{ count: number }>(
    `select count(*)::int as count from pg_stat_activity
     where wait_event_type = 'Lock' and wait_event = 'advisory' and query ~ '(save_setup_draft|complete_setup)'`,
  );
  return row.count;
}

/** Resolves true once exactly `expected` setup requests are blocked on an advisory lock. */
async function waitForBlocked(expected: number): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await blockedSetupRequests()) === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function countRows(table: string, membershipId: string): Promise<number> {
  const [row] = await db.admin<{ count: number }>(
    `select count(*)::int as count from public.${table} where owner_membership_id = $1`,
    [membershipId],
  );
  return row.count;
}

const COMMITTED_TABLES = ["courses", "class_sections", "bell_schedules", "schedule_blocks", "teacher_schedule_preferences", "lessons", "lesson_class_sections", "setup_completions"];

async function committedOnce(membershipId: string): Promise<boolean> {
  for (const table of COMMITTED_TABLES) {
    if ((await countRows(table, membershipId)) !== 1) return false;
  }
  return (await countRows("setup_drafts", membershipId)) === 0;
}

type CompleteOutcome = SetupCallResult<CompleteSetupResult>;
type SaveOutcome = SetupCallResult<SaveSetupDraftResult>;

function completedFresh(outcome: CompleteOutcome): boolean {
  return outcome.ok && outcome.value.status === "completed" && !outcome.value.replayed;
}
function completedReplay(outcome: CompleteOutcome): boolean {
  return outcome.ok && outcome.value.status === "completed" && outcome.value.replayed;
}
function saved(outcome: SaveOutcome): boolean {
  return outcome.ok && outcome.value.status === "saved";
}
function saveConflict(outcome: SaveOutcome, reason: string): boolean {
  return outcome.ok && outcome.value.status === "conflict" && outcome.value.reason === reason;
}

async function main() {
  db = await createTestDatabase();
  const [{ server_version: version }] = await db.admin<{ server_version: string }>("show server_version");
  console.log(`PostgreSQL ${version}, ${OVERLAP} overlapping requests per scenario\n`);

  console.log(`1. ${OVERLAP} overlapping completions of one operation`);
  {
    const teacher = await newFounder("complete-race");
    const { operationId, revision } = await seedDraft(teacher, completeDraft());
    const release = await holdSetupLock(teacher.membershipId);
    const requests = Array.from({ length: OVERLAP }, () => teacher.repository.completeSetup(operationId, revision));
    check(`all ${OVERLAP} are open at once, blocked on the membership's lock`, await waitForBlocked(OVERLAP));
    check("nothing is committed while they wait", (await countRows("setup_completions", teacher.membershipId)) === 0 && (await countRows("courses", teacher.membershipId)) === 0);
    await release();
    const outcomes = await Promise.all(requests);

    check("exactly one performed the commit", outcomes.filter(completedFresh).length === 1);
    check(`the other ${OVERLAP - 1} were answered as replays`, outcomes.filter(completedReplay).length === OVERLAP - 1);
    const completions = outcomes.map((outcome) => (outcome.ok && outcome.value.status === "completed" ? outcome.value.completion : null));
    check("every caller received the identical result", completions.every((completion) => completion !== null && deepEqual(completion, completions[0])));
    check("every table holds exactly one row; the draft is gone", await committedOnce(teacher.membershipId));
  }

  console.log(`\n2. ${OVERLAP} overlapping saves from the same revision`);
  {
    const teacher = await newFounder("save-race");
    const { operationId, revision } = await seedDraft(teacher, createEmptySetupDraft());
    const waves: Array<SetupDraft["lunchWave"]> = ["A", "B", "C"];
    const payloads = Array.from({ length: OVERLAP }, (_, index) => ({ ...createEmptySetupDraft(), lunchWave: waves[index % 3], courses: [{ id: `course-${index}`, name: `Writer ${index}` }] }));
    const release = await holdSetupLock(teacher.membershipId);
    const requests = payloads.map((payload) => teacher.repository.saveDraft(revision, payload));
    check(`all ${OVERLAP} are open at once, blocked on the membership's lock`, await waitForBlocked(OVERLAP));
    await release();
    const outcomes = await Promise.all(requests);

    const winnerIndex = outcomes.findIndex(saved);
    check("exactly one save was accepted", outcomes.filter(saved).length === 1);
    check(`the other ${OVERLAP - 1} were refused as stale-revision`, outcomes.filter((outcome) => saveConflict(outcome, "stale-revision")).length === OVERLAP - 1);
    const [stored] = await db.admin<{ revision: number; payload: SetupDraft; operation_id: string }>(
      "select revision, payload, operation_id from public.setup_drafts where owner_membership_id = $1", [teacher.membershipId]);
    check("the revision advanced by exactly one", stored.revision === revision + 1);
    check("the stored draft is the winner's, whole - no fields from any other writer", deepEqual(stored.payload, payloads[winnerIndex]));
    check("every refusal carried the winner's draft, so each loser can show it", outcomes.every((outcome, index) => index === winnerIndex ||
      (outcome.ok && outcome.value.status === "conflict" && "draft" in outcome.value && deepEqual(outcome.value.draft.payload, payloads[winnerIndex]) && outcome.value.draft.revision === revision + 1)));
    check("the operation id did not change", stored.operation_id === operationId);
  }

  console.log(`\n3. ${OVERLAP} overlapping attempts to create the first draft`);
  {
    const teacher = await newFounder("create-race");
    const release = await holdSetupLock(teacher.membershipId);
    const requests = Array.from({ length: OVERLAP }, () => teacher.repository.saveDraft(null, createEmptySetupDraft()));
    check(`all ${OVERLAP} are open at once, blocked on the membership's lock`, await waitForBlocked(OVERLAP));
    await release();
    const outcomes = await Promise.all(requests);

    check("exactly one created the draft", outcomes.filter(saved).length === 1);
    check(`the other ${OVERLAP - 1} were told a draft already exists`, outcomes.filter((outcome) => saveConflict(outcome, "draft-exists")).length === OVERLAP - 1);
    check("one draft row, at revision 1", (await countRows("setup_drafts", teacher.membershipId)) === 1);
    const operationIds = new Set(outcomes.map((outcome) => (outcome.ok && outcome.value.status === "saved" ? outcome.value.operationId : outcome.ok && outcome.value.status === "conflict" && "draft" in outcome.value ? outcome.value.draft.operationId : "?")));
    check("every caller learned the same single operation id", operationIds.size === 1 && !operationIds.has("?"));
  }

  console.log("\n4. A save and a completion overlapping, in both orders");
  {
    // Requests queue on the lock in arrival order, so the order below is the order they run.
    const saveFirst = await newFounder("save-then-complete");
    const first = await seedDraft(saveFirst, completeDraft());
    let release = await holdSetupLock(saveFirst.membershipId);
    const save = saveFirst.repository.saveDraft(first.revision, completeDraft("B"));
    await waitForBlocked(1);
    const complete = saveFirst.repository.completeSetup(first.operationId, first.revision);
    check("both are open at once", await waitForBlocked(2));
    await release();
    const [saveOutcome, completeOutcome] = await Promise.all([save, complete]);
    check("save first: the save is accepted", saved(saveOutcome));
    check("...and the completion, now naming an old revision, is refused", completeOutcome.ok && completeOutcome.value.status === "conflict" && completeOutcome.value.reason === "stale-revision");
    check("...having committed nothing, with the draft kept at the new revision", (await countRows("setup_completions", saveFirst.membershipId)) === 0 && (await countRows("courses", saveFirst.membershipId)) === 0 &&
      (await db.admin<{ revision: number }>("select revision from public.setup_drafts where owner_membership_id = $1", [saveFirst.membershipId]))[0].revision === first.revision + 1);

    const completeFirst = await newFounder("complete-then-save");
    const second = await seedDraft(completeFirst, completeDraft());
    release = await holdSetupLock(completeFirst.membershipId);
    const completeEarly = completeFirst.repository.completeSetup(second.operationId, second.revision);
    await waitForBlocked(1);
    const saveLate = completeFirst.repository.saveDraft(second.revision, completeDraft("C"));
    check("both are open at once", await waitForBlocked(2));
    await release();
    const [completeEarlyOutcome, saveLateOutcome] = await Promise.all([completeEarly, saveLate]);
    check("completion first: it commits", completedFresh(completeEarlyOutcome));
    check("...and the overlapping save is answered 'completed' instead of resurrecting a draft", saveLateOutcome.ok && saveLateOutcome.value.status === "completed");
    check("...leaving exactly one committed setup and no draft", await committedOnce(completeFirst.membershipId));
  }

  console.log("\n5. One membership's lock never blocks another's");
  {
    const blocked = await newFounder("held");
    const free = await newFounder("free");
    const held = await seedDraft(blocked, createEmptySetupDraft());
    const release = await holdSetupLock(blocked.membershipId);
    const waiting = blocked.repository.saveDraft(held.revision, createEmptySetupDraft());
    await waitForBlocked(1);
    const unaffected = await free.repository.saveDraft(null, createEmptySetupDraft());
    check("another membership saves immediately while the first is still waiting", saved(unaffected) && (await blockedSetupRequests()) === 1);
    await release();
    check("the first then proceeds", saved(await waiting));
  }

  console.log("\n6. Unsynchronized races - nothing held, requests simply fired together");
  {
    let exactlyOne = 0;
    let allConsistent = 0;
    const rounds = 10;
    const burst = 16;
    for (let round = 0; round < rounds; round += 1) {
      const teacher = await newFounder(`free-race-${round}`);
      const { operationId, revision } = await seedDraft(teacher, completeDraft());
      const outcomes = await Promise.all(Array.from({ length: burst }, () => teacher.repository.completeSetup(operationId, revision)));
      if (outcomes.filter(completedFresh).length === 1 && outcomes.filter(completedReplay).length === burst - 1) exactlyOne += 1;
      if (await committedOnce(teacher.membershipId)) allConsistent += 1;
    }
    check(`${rounds} rounds of ${burst} simultaneous completions: one commit and ${burst - 1} replays every time`, exactlyOne === rounds);
    check("...and exactly one of every row every time", allConsistent === rounds);

    let oneWinner = 0;
    for (let round = 0; round < rounds; round += 1) {
      const teacher = await newFounder(`free-save-${round}`);
      const { revision } = await seedDraft(teacher, createEmptySetupDraft());
      const outcomes = await Promise.all(Array.from({ length: burst }, (_, index) => teacher.repository.saveDraft(revision, { ...createEmptySetupDraft(), courses: [{ id: `c-${index}`, name: `W${index}` }] })));
      const [stored] = await db.admin<{ revision: number }>("select revision from public.setup_drafts where owner_membership_id = $1", [teacher.membershipId]);
      if (outcomes.filter(saved).length === 1 && outcomes.filter((outcome) => saveConflict(outcome, "stale-revision")).length === burst - 1 && stored.revision === revision + 1) oneWinner += 1;
    }
    check(`${rounds} rounds of ${burst} simultaneous saves from one revision: one accepted, revision +1, every time`, oneWinner === rounds);
  }

  console.log("\n7. If the lock were not there: the constraints alone still prevent a duplicate");
  {
    const teacher = await newFounder("backstop");
    const { operationId, revision } = await seedDraft(teacher, completeDraft());
    const expectUnique = async (sql: string, params: unknown[]) => {
      try {
        await db.admin(sql, params);
        return false;
      } catch (error) {
        return (error as { code?: string }).code === "23505";
      }
    };
    check("a second draft row for one membership is impossible", await expectUnique(
      `insert into public.setup_drafts (owner_membership_id, organization_id, payload) values ($1, $2, '{}'::jsonb)`, [teacher.membershipId, teacher.organizationId]));
    await teacher.repository.completeSetup(operationId, revision);
    check("a second completion for one membership is impossible", await expectUnique(
      `insert into public.setup_completions (operation_id, owner_membership_id, organization_id, result) values (gen_random_uuid(), $1, $2, '{}'::jsonb)`, [teacher.membershipId, teacher.organizationId]));
    const other = await newFounder("backstop-other");
    check("one operation id cannot be recorded twice, even for another membership", await expectUnique(
      `insert into public.setup_completions (operation_id, owner_membership_id, organization_id, result) values ($1, $2, $3, '{}'::jsonb)`, [operationId, other.membershipId, other.organizationId]));

    // A caller whose transaction took its snapshot BEFORE another request
    // committed (REPEATABLE READ) cannot see that commit, so the replay check
    // misses and it tries to write. This is the case the lock alone does not
    // cover; it must fail outright rather than write a second copy.
    const stale = await newFounder("stale-snapshot");
    const draft = await seedDraft(stale, completeDraft());
    const connection = await db.connect();
    let error: { code?: string } | null = null;
    try {
      await connection.query("begin isolation level repeatable read");
      await connection.query("set local role authenticated");
      await connection.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: stale.userId })]);
      await connection.query("select count(*) from public.organizations"); // the snapshot is taken here
      const committed = await stale.repository.completeSetup(draft.operationId, draft.revision);
      if (!completedFresh(committed)) throw new Error("setup for the stale-snapshot case did not commit");
      await connection.query("select public.complete_setup(p_organization_id => $1, p_operation_id => $2, p_expected_revision => $3)", [stale.organizationId, draft.operationId, draft.revision]);
      await connection.query("commit");
    } catch (caught) {
      error = caught as { code?: string };
      await connection.query("rollback").catch(() => {});
    } finally {
      connection.release();
    }
    check("a stale-snapshot (REPEATABLE READ) caller fails with a unique or serialization error", error !== null && (error.code === "23505" || error.code === "40001"));
    check("...and leaves exactly one committed setup", await committedOnce(stale.membershipId));
  }

  console.log("\n8. Nothing is left behind");
  {
    const [locks] = await db.admin<{ count: number }>("select count(*)::int as count from pg_locks where locktype = 'advisory'");
    check("no advisory lock is still held", locks.count === 0);
    const [open] = await db.admin<{ count: number }>("select count(*)::int as count from pg_stat_activity where state like 'idle in transaction%'");
    check("no transaction was left open", open.count === 0);
  }

  await db.close();
  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db?.close().catch(() => {});
  process.exit(1);
});
