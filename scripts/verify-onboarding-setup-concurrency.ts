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

import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import { deepEqual } from "@/lib/data/supabaseMapping";
import { SupabaseSetupRepository } from "@/lib/data/supabaseSetupRepository";
import type { AppData } from "@/lib/data/types";
import { createEmptySetupDraft } from "@/lib/onboarding/setupDraft";
import type { CompleteSetupResult, SaveSetupDraftResult, SetupCallResult } from "@/lib/onboarding/setupRepository";
import { generateId } from "@/lib/store/id";
import type { SetupDraft, SetupSeed } from "@/types/setupDraft";
import type { PoolClient } from "pg";
import { createTestDatabase, type RpcClient, type TestDatabase } from "./support/testDatabase";

/** The seed of an account that has chosen nothing yet: no preferences row. */
const EMPTY_SEED: SetupSeed = { activeBellScheduleId: null, lunchWave: "none" };

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
  client: RpcClient;
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
  return { userId, organizationId: row.organization_id, membershipId: row.id, client, repository: new SupabaseSetupRepository(client, row.organization_id) };
}

/**
 * A transaction opened as `userId` - the authenticated role, the user's JWT
 * claim, READ COMMITTED - exactly as the test client runs each request, but
 * left open so the test decides when it commits. Statements run in it are
 * the production functions themselves.
 */
async function openUserTransaction(userId: string): Promise<{ connection: PoolClient; pid: number; commit: () => Promise<void> }> {
  const connection = await db.connect();
  await connection.query("begin isolation level read committed");
  await connection.query("set local role authenticated");
  await connection.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  const pid = (await connection.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
  return {
    connection,
    pid,
    commit: async () => {
      await connection.query("commit");
      connection.release();
    },
  };
}

/** The backend running a statement that matches `pattern`, once it is waiting on a lock held by `holderPid`. */
async function waitingBehind(holderPid: number, pattern: string): Promise<number | null> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await db.admin<{ pid: number }>(
      `select pid from pg_stat_activity
       where wait_event_type = 'Lock' and query ~ $1 and $2 = any (pg_blocking_pids(pid))`,
      [pattern, holderPid],
    );
    if (row) return row.pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

/** Relations a backend holds or awaits any lock on. */
async function relationsLockedBy(pid: number): Promise<string[]> {
  const rows = await db.admin<{ relation: string }>(
    "select distinct relation::regclass::text as relation from pg_locks where pid = $1 and relation is not null",
    [pid],
  );
  return rows.map((row) => row.relation);
}

/** The ordinary app's repository for this teacher - the real save path, over the test client. */
function ordinaryTab(teacher: Teacher): SupabaseDataRepository {
  return new SupabaseDataRepository(teacher.client as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0], {
    organizationId: teacher.organizationId,
    membershipId: teacher.membershipId,
  });
}

function withLunchWave(data: AppData, lunchWave: AppData["teacherSchedulePreferences"]["lunchWave"]): AppData {
  return { ...data, teacherSchedulePreferences: { ...data.teacherSchedulePreferences, lunchWave } };
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
  const result = await teacher.repository.saveDraft(null, draft, EMPTY_SEED);
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

/** Resolves true once exactly `expected` complete_setup requests are waiting on another transaction's row lock. */
async function waitForRowLockWait(expected: number): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await db.admin<{ count: number }>(
      `select count(*)::int as count from pg_stat_activity
       where wait_event_type = 'Lock' and wait_event in ('transactionid', 'tuple') and query ~ 'complete_setup'`,
    );
    if (row.count === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

/** A teacher with a saved, complete draft that follows a one-period shared schedule in their school. */
async function sharedScheduleTeacher(label: string): Promise<{ teacher: Teacher; scheduleId: string; operationId: string; revision: number }> {
  const teacher = await newFounder(label);
  const scheduleId = generateId("schedule");
  await db.admin(
    `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source)
     values ($1, $2, 'organization', null, 'Regular Day', true, 'built-in')`,
    [scheduleId, teacher.organizationId],
  );
  await db.admin(
    `insert into public.schedule_blocks (id, bell_schedule_id, organization_id, owner_type, owner_membership_id, position, label, kind, start_time, end_time)
     values ($1 || ':p1', $1, $2, 'organization', null, 0, '1st Hour', 'instructional', '08:00', '08:50')`,
    [scheduleId, teacher.organizationId],
  );
  const base = completeDraft();
  const seeded = await seedDraft(teacher, {
    ...base,
    schedule: {
      mode: "shared",
      scheduleId,
      expectedBlocks: [{ id: "p1", label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", customKindLabel: null, isLunchWindow: false, overrides: [] }],
      assignments: [{ id: crypto.randomUUID(), blockId: "p1", classSectionId: base.classSections[0].id }],
    },
  });
  return { teacher, scheduleId, ...seeded };
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
    const requests = payloads.map((payload) => teacher.repository.saveDraft(revision, payload, null));
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
    const requests = Array.from({ length: OVERLAP }, () => teacher.repository.saveDraft(null, createEmptySetupDraft(), EMPTY_SEED));
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
    const save = saveFirst.repository.saveDraft(first.revision, completeDraft("B"), null);
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
    const saveLate = completeFirst.repository.saveDraft(second.revision, completeDraft("C"), null);
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
    const waiting = blocked.repository.saveDraft(held.revision, createEmptySetupDraft(), null);
    await waitForBlocked(1);
    const unaffected = await free.repository.saveDraft(null, createEmptySetupDraft(), EMPTY_SEED);
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
      const outcomes = await Promise.all(Array.from({ length: burst }, (_, index) => teacher.repository.saveDraft(revision, { ...createEmptySetupDraft(), courses: [{ id: `c-${index}`, name: `W${index}` }] }, null)));
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
      `insert into public.setup_drafts (owner_membership_id, organization_id, payload, baseline_lunch_wave) values ($1, $2, '{}'::jsonb, 'none')`, [teacher.membershipId, teacher.organizationId]));
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

  console.log("\n8. An ordinary save creating a class while setup completes");
  {
    // The ordinary save path never takes the setup advisory lock. What
    // makes the eligibility re-check hold is the membership row lock:
    // this in-flight, uncommitted class insert must be waited for and seen.
    const teacher = await newFounder("racing-ordinary-setup");
    const draft = await seedDraft(teacher, completeDraft());
    const courseId = generateId("course");
    const sectionId = generateId("section");
    const ordinary = await db.connect();
    await ordinary.query("begin");
    await ordinary.query(`insert into public.courses (id, organization_id, owner_type, owner_membership_id, name) values ($1, $2, 'teacher', $3, 'Algebra')`, [courseId, teacher.organizationId, teacher.membershipId]);
    await ordinary.query(`insert into public.class_sections (id, organization_id, owner_membership_id, course_id, name) values ($1, $2, $3, $4, 'Algebra - 2nd Hour')`, [sectionId, teacher.organizationId, teacher.membershipId, courseId]);

    const completing = teacher.repository.completeSetup(draft.operationId, draft.revision);
    check("the completion waits for the in-flight class insert instead of deciding without it", await waitForRowLockWait(1));
    await ordinary.query("commit");
    ordinary.release();
    const outcome = await completing;
    check("...and then returns no-longer-eligible", outcome.ok && outcome.value.status === "conflict" && outcome.value.reason === "no-longer-eligible");
    check(
      "nothing from the draft was written",
      (await countRows("class_sections", teacher.membershipId)) === 1 &&
        (await countRows("bell_schedules", teacher.membershipId)) === 0 &&
        (await countRows("lessons", teacher.membershipId)) === 0 &&
        (await countRows("teacher_schedule_preferences", teacher.membershipId)) === 0 &&
        (await countRows("setup_completions", teacher.membershipId)) === 0 &&
        (await countRows("setup_drafts", teacher.membershipId)) === 1,
    );
  }

  console.log("\n9. An admin editing the shared schedule while setup completes");
  {
    // No lock is taken on the shared schedule (see complete_setup 5a). These
    // two cases show what an edit overlapping a completion actually leaves.

    // (a) A period is being DELETED, uncommitted, when completion runs.
    const deleting = await sharedScheduleTeacher("racing-block-delete");
    const admin = await db.connect();
    await admin.query("begin");
    await admin.query("delete from public.schedule_blocks where id = $1", [`${deleting.scheduleId}:p1`]);
    const completing = deleting.teacher.repository.completeSetup(deleting.operationId, deleting.revision);
    check("the completion waits on the period it is about to reference", await waitForRowLockWait(1));
    await admin.query("commit");
    admin.release();
    const failed = await completing;
    check("...and fails as a whole once the delete commits", !failed.ok && failed.kind === "rejected");
    check(
      "nothing was committed - no class, no preference, no completion; the draft is intact",
      (await countRows("class_sections", deleting.teacher.membershipId)) === 0 &&
        (await countRows("teacher_period_assignments", deleting.teacher.membershipId)) === 0 &&
        (await countRows("teacher_schedule_preferences", deleting.teacher.membershipId)) === 0 &&
        (await countRows("setup_completions", deleting.teacher.membershipId)) === 0 &&
        (await countRows("setup_drafts", deleting.teacher.membershipId)) === 1,
    );
    const retried = await deleting.teacher.repository.completeSetup(deleting.operationId, deleting.revision);
    check("the retry reports shared-schedule-changed", retried.ok && retried.value.status === "conflict" && retried.value.reason === "shared-schedule-changed");

    // (b) A period is being RE-TIMED, uncommitted, when completion runs.
    const retiming = await sharedScheduleTeacher("racing-block-retime");
    const editor = await db.connect();
    await editor.query("begin");
    await editor.query("update public.schedule_blocks set start_time = '08:05' where id = $1", [`${retiming.scheduleId}:p1`]);
    const completed = await retiming.teacher.repository.completeSetup(retiming.operationId, retiming.revision);
    await editor.query("commit");
    editor.release();
    check("the completion commits against the schedule as it stood", completedFresh(completed));
    const [assigned] = await db.admin<{ start_time: string }>(
      `select sb.start_time::text as start_time from public.teacher_period_assignments a
       join public.schedule_blocks sb on sb.id = a.schedule_block_id where a.owner_membership_id = $1`,
      [retiming.teacher.membershipId],
    );
    check("...and the result is exactly 'completed, then edited': the assignment follows the re-timed period", assigned?.start_time === "08:05:00");
  }

  console.log("\n10. Ordinary preference writes and completion, each order, deterministically");
  {
    // The ordinary save writes teacher_schedule_preferences only through
    // save_teacher_schedule_preferences(), which takes the membership row
    // lock complete_setup() takes, before it touches the preferences row.
    // Each case below runs one side in a transaction the test holds open,
    // starts the other, and inspects pg_locks while it waits: the waiting
    // side must not have touched teacher_schedule_preferences at all - so
    // neither side can hold that row while waiting for the membership row.
    // Ordinary-side calls are the production function, or (when it goes
    // second) the real SupabaseDataRepository save.
    const PREFERENCES = "teacher_schedule_preferences";
    const preferences = async (membershipId: string) =>
      (await db.admin<{ lunch_wave: string; active_bell_schedule_id: string | null }>("select lunch_wave, active_bell_schedule_id from public.teacher_schedule_preferences where owner_membership_id = $1", [membershipId]))[0] ?? null;
    const nothingCommitted = async (membershipId: string) =>
      (await countRows("class_sections", membershipId)) === 0 &&
      (await countRows("bell_schedules", membershipId)) === 0 &&
      (await countRows("lessons", membershipId)) === 0 &&
      (await countRows("setup_completions", membershipId)) === 0 &&
      (await countRows("setup_drafts", membershipId)) === 1;
    const preferencesChanged = (outcome: CompleteOutcome, expected: SetupSeed) =>
      outcome.ok && outcome.value.status === "conflict" && outcome.value.reason === "preferences-changed" && deepEqual(outcome.value.preferences, expected);
    const ownScheduleId = (draft: SetupDraft) => (draft.schedule?.mode === "own" ? draft.schedule.id : null);
    /** A teacher with a saved own-schedule draft; `withRow` gives them a preferences row (no schedule, no lunch wave) first. */
    const teacherWithDraft = async (label: string, withRow: boolean) => {
      const teacher = await newFounder(label);
      if (withRow) {
        await db.admin("insert into public.teacher_schedule_preferences (owner_membership_id, organization_id) values ($1, $2)", [teacher.membershipId, teacher.organizationId]);
      }
      const draft = completeDraft();
      return { teacher, draft, seeded: await seedDraft(teacher, draft) };
    };
    const ordinaryWrite = (connection: PoolClient, teacher: Teacher, lunchWave: string) =>
      connection.query("select public.save_teacher_schedule_preferences($1, $2, null, array['lunch_wave'])", [teacher.organizationId, lunchWave]);

    // (a) Ordinary UPDATE first, completion second.
    {
      const { teacher, seeded } = await teacherWithDraft("order-update-then-complete", true);
      const ordinary = await openUserTransaction(teacher.userId);
      await ordinaryWrite(ordinary.connection, teacher, "B");
      const completing = teacher.repository.completeSetup(seeded.operationId, seeded.revision);
      const waiter = await waitingBehind(ordinary.pid, "complete_setup");
      check("(a) UPDATE first: completion waits behind the ordinary write", waiter !== null);
      check("(a) ...before it has touched teacher_schedule_preferences", waiter !== null && !(await relationsLockedBy(waiter)).includes(PREFERENCES));
      await ordinary.commit();
      const outcome = await completing;
      check("(a) ...then returns preferences-changed with the newer lunch wave", preferencesChanged(outcome, { activeBellScheduleId: null, lunchWave: "B" }));
      check("(a) nothing from the draft was written; the newer lunch wave stands", (await nothingCommitted(teacher.membershipId)) && (await preferences(teacher.membershipId))?.lunch_wave === "B");
    }

    // (b) Completion first, ordinary UPDATE second - the case that used to be rejected by RLS, because the
    // completion makes a schedule it has just created active.
    {
      const { teacher, draft, seeded } = await teacherWithDraft("order-complete-then-update", true);
      const tab = ordinaryTab(teacher);
      const loaded = await tab.load();
      const completion = await openUserTransaction(teacher.userId);
      const committed = await completion.connection.query<{ result: { status: string } }>("select public.complete_setup($1, $2, $3) as result", [teacher.organizationId, seeded.operationId, seeded.revision]);
      check("(b) completion first: it has completed, not yet committed", committed.rows[0].result.status === "completed");
      const saving = tab.save(withLunchWave(loaded, "C"));
      const waiter = await waitingBehind(completion.pid, "save_teacher_schedule_preferences");
      check("(b) the ordinary save waits behind the completion", waiter !== null);
      check("(b) ...before it has touched teacher_schedule_preferences", waiter !== null && !(await relationsLockedBy(waiter)).includes(PREFERENCES));
      await completion.commit();
      const saved = await saving;
      check("(b) ...then succeeds - no RLS rejection", saved.ok);
      check("(b) the newer lunch wave is stored, on top of the schedule the completion made active", deepEqual(await preferences(teacher.membershipId), { lunch_wave: "C", active_bell_schedule_id: ownScheduleId(draft) }));
      const replay = await teacher.repository.completeSetup(seeded.operationId, seeded.revision);
      check("(b) a retry of the completed operation is still replayed", completedReplay(replay));
      check("(b) ...and does not put the older lunch wave back", (await preferences(teacher.membershipId))?.lunch_wave === "C");
    }

    // (b, control) The same ordering with the old direct table UPDATE, which takes no membership lock.
    // It shows the two checks above can fail: this writer is already holding teacher_schedule_preferences
    // while it waits, and is then rejected by the table's WITH CHECK policy. It is also what any writer
    // outside the protocol (an older client bundle, a direct API call) still gets.
    {
      const { teacher, seeded } = await teacherWithDraft("order-complete-then-direct-update", true);
      const completion = await openUserTransaction(teacher.userId);
      await completion.connection.query("select public.complete_setup($1, $2, $3)", [teacher.organizationId, seeded.operationId, seeded.revision]);
      const direct = db
        .asUser(teacher.userId, "update public.teacher_schedule_preferences set lunch_wave = 'C' where owner_membership_id = $1", [teacher.membershipId])
        .then(() => null, (error: { code?: string }) => error.code ?? "error");
      const waiter = await waitingBehind(completion.pid, "update public.teacher_schedule_preferences");
      check("(control) a direct UPDATE waits holding teacher_schedule_preferences - the check above can tell", waiter !== null && (await relationsLockedBy(waiter)).includes(PREFERENCES));
      await completion.commit();
      check("(control) ...and is then rejected by RLS (42501), as before this protocol", (await direct) === "42501");
    }

    // (c) Ordinary first-row INSERT first, completion second.
    {
      const { teacher, seeded } = await teacherWithDraft("order-insert-then-complete", false);
      const ordinary = await openUserTransaction(teacher.userId);
      await ordinaryWrite(ordinary.connection, teacher, "A");
      check("(c) INSERT first: the ordinary write created the row (uncommitted)", (await ordinary.connection.query("select 1 from public.teacher_schedule_preferences where owner_membership_id = $1", [teacher.membershipId])).rowCount === 1);
      const completing = teacher.repository.completeSetup(seeded.operationId, seeded.revision);
      const waiter = await waitingBehind(ordinary.pid, "complete_setup");
      check("(c) completion waits behind the ordinary write", waiter !== null);
      check("(c) ...before it has touched teacher_schedule_preferences", waiter !== null && !(await relationsLockedBy(waiter)).includes(PREFERENCES));
      await ordinary.commit();
      const outcome = await completing;
      check("(c) ...then returns preferences-changed with the newer lunch wave", preferencesChanged(outcome, { activeBellScheduleId: null, lunchWave: "A" }));
      check("(c) nothing from the draft was written; the new row stands", (await nothingCommitted(teacher.membershipId)) && (await preferences(teacher.membershipId))?.lunch_wave === "A");
    }

    // (d) Completion first (it creates the row), ordinary first-row write second. With direct table
    // writes the ordinary INSERT took its row first and the membership lock last - the opposite order.
    {
      const { teacher, draft, seeded } = await teacherWithDraft("order-complete-then-insert", false);
      const tab = ordinaryTab(teacher);
      const loaded = await tab.load();
      const completion = await openUserTransaction(teacher.userId);
      await completion.connection.query("select public.complete_setup($1, $2, $3)", [teacher.organizationId, seeded.operationId, seeded.revision]);
      const saving = tab.save(withLunchWave(loaded, "C"));
      const waiter = await waitingBehind(completion.pid, "save_teacher_schedule_preferences");
      check("(d) completion first: the ordinary save waits behind it", waiter !== null);
      check("(d) ...before it has touched teacher_schedule_preferences - the lock order is the same on both sides", waiter !== null && !(await relationsLockedBy(waiter)).includes(PREFERENCES));
      await completion.commit();
      const saved = await saving;
      check("(d) ...then succeeds", saved.ok);
      check("(d) one row: the newer lunch wave on top of the schedule the completion made active", (await countRows("teacher_schedule_preferences", teacher.membershipId)) === 1 &&
        deepEqual(await preferences(teacher.membershipId), { lunch_wave: "C", active_bell_schedule_id: ownScheduleId(draft) }));
      check("(d) a retry of the completed operation is still replayed", completedReplay(await teacher.repository.completeSetup(seeded.operationId, seeded.revision)));
    }

    // (e) Supplementary, not the evidence for ordering: the same two writers fired together with nothing
    // held. Every round must end as (a) or (b) did - never a rejected ordinary write.
    const ROUNDS = 8;
    let refused = 0;
    let landedOnTop = 0;
    let wrong = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const { teacher, seeded } = await teacherWithDraft(`order-free-${round}`, true);
      const [outcome, written] = await Promise.all([
        teacher.repository.completeSetup(seeded.operationId, seeded.revision),
        teacher.client.rpc("save_teacher_schedule_preferences", { p_organization_id: teacher.organizationId, p_lunch_wave: "C", p_active_bell_schedule_id: null, p_changed_columns: ["lunch_wave"] }),
      ]);
      if (written.error) wrong += 1;
      else if (preferencesChanged(outcome, { activeBellScheduleId: null, lunchWave: "C" })) refused += 1;
      else if (completedFresh(outcome)) landedOnTop += 1;
      else wrong += 1;
      if ((await preferences(teacher.membershipId))?.lunch_wave !== "C") wrong += 1;
    }
    console.log(`  (${ROUNDS} unsynchronized rounds: completion refused ${refused}; ordinary write landed on top ${landedOnTop})`);
    check("(e) every unsynchronized round ended one of those two ways, with no rejected write", wrong === 0 && refused + landedOnTop === ROUNDS);
  }

  console.log("\n11. Nothing is left behind");
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
