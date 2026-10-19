/**
 * Completion versus ordinary preference saves, each order, through Supabase's
 * transaction pooler (Supavisor) on the hosted staging project
 * `falcondeck-staging` - the hosted counterpart of
 * verify-onboarding-setup-concurrency.ts §10, which proves the same lock
 * order on a local PostgreSQL. Only the staging project is accepted
 * (scripts/support/stagingPooler.ts); every other target is refused before
 * anything is written.
 *
 *   npm run verify:onboarding-setup-pooler            check the target only; writes nothing
 *   npm run verify:onboarding-setup-pooler -- --run   run the scenarios
 *   npm run verify:onboarding-setup-pooler -- --cleanup-leftovers
 *                                                     remove fixtures a crashed run left behind
 *
 * HOW ORDER IS PROVEN: one side runs in a transaction the test holds open
 * (pinned to one server backend by the pooler for its whole duration); the
 * other is started on another pooled connection; pg_stat_activity shows it
 * blocked behind the first backend, and pg_locks shows it has not touched
 * teacher_schedule_preferences while it waits. Only then is the first
 * committed. Every unit of work is an explicit `begin` … `commit` (or a
 * single statement), with `set local` only - nothing depends on session
 * state, which a transaction pooler does not keep.
 *
 * FIXTURES: each case gets a new Auth user `pooler-<run>-<case>+<tag>@example.test`
 * and a new school from bootstrap_organization(), the production function.
 * Nothing else is read for writing. Every other row of every organization-
 * scoped table, `organizations` and `auth.users` is fingerprinted before and
 * after and must be unchanged. Cleanup deletes only the run's own users,
 * memberships and schools, in dependency order, in one transaction.
 *
 * WHAT THIS IS NOT: PostgREST. The deployed app reaches the database through
 * PostgREST, which connects to Postgres directly, not through Supavisor; the
 * HTTPS checks cover that path (docs/ONBOARDING_SETUP_RELEASE.md §5). This
 * checks the lock order on Supabase's hosted Postgres with transactions
 * multiplexed by its pooler.
 */

import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import { deepEqual } from "@/lib/data/supabaseMapping";
import { SupabaseSetupRepository } from "@/lib/data/supabaseSetupRepository";
import type { AppData } from "@/lib/data/types";
import { createEmptySetupDraft } from "@/lib/onboarding/setupDraft";
import type { CompleteSetupResult, SetupCallResult } from "@/lib/onboarding/setupRepository";
import { generateId } from "@/lib/store/id";
import type { SetupDraft, SetupSeed } from "@/types/setupDraft";
import type { PoolClient } from "pg";
import { connectToStaging, stagingTarget } from "./support/stagingPooler";
import type { RpcClient, TestDatabase } from "./support/testDatabase";

const EMPTY_SEED: SetupSeed = { activeBellScheduleId: null, lunchWave: "none" };
const PREFERENCES = "teacher_schedule_preferences";
const RUN = `pooler-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6)}`;
const FIXTURE_EMAIL = /^pooler-\d{8}-[0-9a-f]{6}-[a-z0-9-]+\+[0-9a-f]{8}@example\.test$/;

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) console.log(`  ok  - ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

let db: TestDatabase;
const createdUsers: string[] = [];

interface Teacher {
  userId: string;
  organizationId: string;
  membershipId: string;
  client: RpcClient;
  repository: SupabaseSetupRepository;
}

async function newFounder(label: string): Promise<Teacher> {
  const userId = await db.createUser(`${RUN}-${label}@example.test`);
  createdUsers.push(userId);
  const client = db.clientFor(userId);
  const { error } = await client.rpc("bootstrap_organization", { organization_name: `${RUN} ${label}` });
  if (error) throw new Error(`bootstrap_organization failed: ${error.message}`);
  const [row] = await db.admin<{ id: string; organization_id: string }>("select id, organization_id from public.organization_memberships where user_id = $1", [userId]);
  return { userId, organizationId: row.organization_id, membershipId: row.id, client, repository: new SupabaseSetupRepository(client, row.organization_id) };
}

/** One explicit transaction as `userId`, held open on one pooled connection until the test commits it. */
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

async function waitingBehind(holderPid: number, pattern: string): Promise<number | null> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
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

async function relationsLockedBy(pid: number): Promise<string[]> {
  const rows = await db.admin<{ relation: string }>("select distinct relation::regclass::text as relation from pg_locks where pid = $1 and relation is not null", [pid]);
  return rows.map((row) => row.relation);
}

function ordinaryTab(teacher: Teacher): SupabaseDataRepository {
  return new SupabaseDataRepository(teacher.client as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0], {
    organizationId: teacher.organizationId,
    membershipId: teacher.membershipId,
  });
}

function withLunchWave(data: AppData, lunchWave: AppData["teacherSchedulePreferences"]["lunchWave"]): AppData {
  return { ...data, teacherSchedulePreferences: { ...data.teacherSchedulePreferences, lunchWave } };
}

function completeDraft(): SetupDraft {
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
    lunchWave: "none",
    firstLesson: { id: generateId("lesson"), date: "2026-10-12", classSectionId: sectionId, learningTarget: "I can.", agendaItems: [], resources: [], announcements: [] },
  };
}

async function countRows(table: string, membershipId: string): Promise<number> {
  const [row] = await db.admin<{ count: number }>(`select count(*)::int as count from public.${table} where owner_membership_id = $1`, [membershipId]);
  return row.count;
}

type CompleteOutcome = SetupCallResult<CompleteSetupResult>;
const completedFresh = (outcome: CompleteOutcome) => outcome.ok && outcome.value.status === "completed" && !outcome.value.replayed;
const completedReplay = (outcome: CompleteOutcome) => outcome.ok && outcome.value.status === "completed" && outcome.value.replayed;

// --- staging safety: fingerprint of everything this run must not touch, and scoped cleanup ----------------

/** Tables in `public` with an organization_id column - every school-scoped row. */
async function schoolScopedTables(): Promise<string[]> {
  const rows = await db.admin<{ table_name: string }>(
    `select c.table_name from information_schema.columns c
     join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'organization_id' order by 1`,
  );
  return rows.map((row) => row.table_name);
}

/** count + md5 of every row outside `excludedOrganizations` / `excludedUsers`, per table. */
async function fingerprint(excludedOrganizations: string[], excludedUsers: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of await schoolScopedTables()) {
    const [row] = await db.admin<{ f: string }>(
      `select count(*) || ':' || coalesce(md5(string_agg(t::text, '|' order by t::text)), '-') as f from public.${table} t where not (t.organization_id = any($1::uuid[]))`,
      [excludedOrganizations],
    );
    result[table] = row.f;
  }
  const [organizations] = await db.admin<{ f: string }>(
    "select count(*) || ':' || coalesce(md5(string_agg(o::text, '|' order by o::text)), '-') as f from public.organizations o where not (o.id = any($1::uuid[]))",
    [excludedOrganizations],
  );
  result.organizations = organizations.f;
  const [users] = await db.admin<{ f: string }>(
    "select count(*) || ':' || coalesce(md5(string_agg(u.id::text || coalesce(u.email, ''), '|' order by u.id)), '-') as f from auth.users u where not (u.id = any($1::uuid[]))",
    [excludedUsers],
  );
  result["auth.users"] = users.f;
  return result;
}

/**
 * Deletes the given fixture users and everything of theirs, in one transaction - refusing if any user is not
 * a pooler fixture, or any of their schools has a member who is not.
 */
async function deleteFixtures(userIds: string[]): Promise<{ users: number; organizations: number }> {
  if (userIds.length === 0) return { users: 0, organizations: 0 };
  const connection = await db.connect();
  try {
    await connection.query("begin");
    const users = (await connection.query<{ id: string; email: string | null }>("select id, email from auth.users where id = any($1::uuid[])", [userIds])).rows;
    const strangers = users.filter((user) => !FIXTURE_EMAIL.test(user.email ?? ""));
    if (strangers.length) throw new Error(`cleanup refused: ${strangers.length} user(s) are not pooler fixtures`);
    const memberships = (await connection.query<{ id: string; organization_id: string }>("select id, organization_id from public.organization_memberships where user_id = any($1::uuid[])", [userIds])).rows;
    const organizationIds = [...new Set(memberships.map((m) => m.organization_id))];
    const [{ outsiders }] = (
      await connection.query<{ outsiders: number }>("select count(*)::int as outsiders from public.organization_memberships where organization_id = any($1::uuid[]) and not (user_id = any($2::uuid[]))", [organizationIds, userIds])
    ).rows;
    if (outsiders !== 0) throw new Error(`cleanup refused: a fixture school has ${outsiders} member(s) who are not fixtures`);
    const membershipIds = memberships.map((m) => m.id);
    // Rows owned by a membership are ON DELETE RESTRICT; remove them first, retrying until none is held back by another.
    const owned = (
      await connection.query<{ table_name: string }>(
        `select c.table_name from information_schema.columns c
         join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
         where c.table_schema = 'public' and c.column_name = 'owner_membership_id' and c.table_name <> 'organization_memberships'`,
      )
    ).rows.map((row) => row.table_name);
    for (let pass = 0; pass < owned.length + 1; pass += 1) {
      let blocked = 0;
      for (const table of owned) {
        await connection.query("savepoint s");
        try {
          await connection.query(`delete from public.${table} where owner_membership_id = any($1::uuid[])`, [membershipIds]);
          await connection.query("release savepoint s");
        } catch {
          await connection.query("rollback to savepoint s");
          blocked += 1;
        }
      }
      if (blocked === 0) break;
    }
    await connection.query("delete from public.organization_memberships where id = any($1::uuid[])", [membershipIds]);
    const deletedOrganizations = (await connection.query("delete from public.organizations where id = any($1::uuid[])", [organizationIds])).rowCount ?? 0;
    const deletedUsers = (await connection.query("delete from auth.users where id = any($1::uuid[])", [userIds])).rowCount ?? 0;
    await connection.query("commit");
    return { users: deletedUsers, organizations: deletedOrganizations };
  } catch (error) {
    await connection.query("rollback").catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function leftoverFixtureUsers(): Promise<string[]> {
  const rows = await db.admin<{ id: string; email: string }>("select id, email from auth.users where email like 'pooler-%@example.test'");
  return rows.filter((row) => FIXTURE_EMAIL.test(row.email)).map((row) => row.id);
}

async function runOrganizations(): Promise<string[]> {
  const rows = await db.admin<{ organization_id: string }>("select distinct organization_id from public.organization_memberships where user_id = any($1::uuid[])", [createdUsers]);
  return rows.map((row) => row.organization_id);
}

// --- the scenarios ---------------------------------------------------------------------------------------

async function scenarios() {
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
  const teacherWithDraft = async (label: string, withRow: boolean) => {
    const teacher = await newFounder(label);
    if (withRow) {
      // The ordinary app's own first save, not a privileged insert.
      const { error } = await teacher.client.rpc("save_teacher_schedule_preferences", { p_organization_id: teacher.organizationId, p_lunch_wave: "none", p_active_bell_schedule_id: null, p_changed_columns: ["lunch_wave"] });
      if (error) throw new Error(`could not create the preferences row: ${error.message}`);
    }
    const draft = completeDraft();
    // The row above holds exactly the empty seed (no schedule, no lunch wave).
    const result = await teacher.repository.saveDraft(null, draft, EMPTY_SEED);
    if (!result.ok || result.value.status !== "saved") throw new Error("could not seed a draft");
    return { teacher, draft, seeded: { operationId: result.value.operationId, revision: result.value.revision } };
  };
  const ordinaryWrite = (connection: PoolClient, teacher: Teacher, lunchWave: string) =>
    connection.query("select public.save_teacher_schedule_preferences($1, $2, null, array['lunch_wave'])", [teacher.organizationId, lunchWave]);

  console.log("1. Existing row: ordinary save first, completion second");
  {
    const { teacher, seeded } = await teacherWithDraft("update-then-complete", true);
    const ordinary = await openUserTransaction(teacher.userId);
    await ordinaryWrite(ordinary.connection, teacher, "B");
    const completing = teacher.repository.completeSetup(seeded.operationId, seeded.revision);
    const waiter = await waitingBehind(ordinary.pid, "complete_setup");
    check("completion waits behind the ordinary write (on another pooled backend)", waiter !== null && waiter !== ordinary.pid);
    check("...before it has touched teacher_schedule_preferences", waiter !== null && !(await relationsLockedBy(waiter)).includes(PREFERENCES));
    await ordinary.commit();
    const outcome = await completing;
    check("...then returns preferences-changed with the newer lunch wave", preferencesChanged(outcome, { activeBellScheduleId: null, lunchWave: "B" }));
    check("nothing from the draft was written; the newer lunch wave stands", (await nothingCommitted(teacher.membershipId)) && (await preferences(teacher.membershipId))?.lunch_wave === "B");
  }

  console.log("\n2. Existing row: completion first, ordinary save second");
  {
    const { teacher, draft, seeded } = await teacherWithDraft("complete-then-update", true);
    const tab = ordinaryTab(teacher);
    const loaded = await tab.load();
    const completion = await openUserTransaction(teacher.userId);
    const committed = await completion.connection.query<{ result: { status: string } }>("select public.complete_setup($1, $2, $3) as result", [teacher.organizationId, seeded.operationId, seeded.revision]);
    check("completion has completed, not yet committed", committed.rows[0].result.status === "completed");
    const saving = tab.save(withLunchWave(loaded, "C"));
    const waiter = await waitingBehind(completion.pid, "save_teacher_schedule_preferences");
    check("the ordinary save waits behind the completion", waiter !== null && waiter !== completion.pid);
    check("...before it has touched teacher_schedule_preferences", waiter !== null && !(await relationsLockedBy(waiter)).includes(PREFERENCES));
    await completion.commit();
    check("...then succeeds - no RLS rejection", (await saving).ok);
    check("the newer lunch wave is stored, on top of the schedule the completion made active", deepEqual(await preferences(teacher.membershipId), { lunch_wave: "C", active_bell_schedule_id: ownScheduleId(draft) }));
    check("a retry of the completed operation is replayed", completedReplay(await teacher.repository.completeSetup(seeded.operationId, seeded.revision)));
    check("...and does not put the older lunch wave back", (await preferences(teacher.membershipId))?.lunch_wave === "C");
  }

  console.log("\n3. Control: completion first, a direct table UPDATE second (outside the protocol)");
  {
    const { teacher, seeded } = await teacherWithDraft("complete-then-direct-update", true);
    const completion = await openUserTransaction(teacher.userId);
    await completion.connection.query("select public.complete_setup($1, $2, $3)", [teacher.organizationId, seeded.operationId, seeded.revision]);
    const direct = db
      .asUser(teacher.userId, "update public.teacher_schedule_preferences set lunch_wave = 'C' where owner_membership_id = $1", [teacher.membershipId])
      .then(() => null, (error: { code?: string }) => error.code ?? "error");
    const waiter = await waitingBehind(completion.pid, "update public.teacher_schedule_preferences");
    check("a direct UPDATE waits holding teacher_schedule_preferences - so the checks above can fail", waiter !== null && (await relationsLockedBy(waiter)).includes(PREFERENCES));
    await completion.commit();
    check("...and is then rejected by RLS (42501)", (await direct) === "42501");
  }

  console.log("\n4. First row: ordinary save creates it first, completion second");
  {
    const { teacher, seeded } = await teacherWithDraft("insert-then-complete", false);
    const ordinary = await openUserTransaction(teacher.userId);
    await ordinaryWrite(ordinary.connection, teacher, "A");
    check("the ordinary write created the row (uncommitted)", (await ordinary.connection.query("select 1 from public.teacher_schedule_preferences where owner_membership_id = $1", [teacher.membershipId])).rowCount === 1);
    const completing = teacher.repository.completeSetup(seeded.operationId, seeded.revision);
    const waiter = await waitingBehind(ordinary.pid, "complete_setup");
    check("completion waits behind the ordinary write", waiter !== null && waiter !== ordinary.pid);
    check("...before it has touched teacher_schedule_preferences", waiter !== null && !(await relationsLockedBy(waiter)).includes(PREFERENCES));
    await ordinary.commit();
    const outcome = await completing;
    check("...then returns preferences-changed with the newer lunch wave", preferencesChanged(outcome, { activeBellScheduleId: null, lunchWave: "A" }));
    check("nothing from the draft was written; the new row stands", (await nothingCommitted(teacher.membershipId)) && (await preferences(teacher.membershipId))?.lunch_wave === "A");
  }

  console.log("\n5. First row: completion creates it first, ordinary save second");
  {
    const { teacher, draft, seeded } = await teacherWithDraft("complete-then-insert", false);
    const tab = ordinaryTab(teacher);
    const loaded = await tab.load();
    const completion = await openUserTransaction(teacher.userId);
    await completion.connection.query("select public.complete_setup($1, $2, $3)", [teacher.organizationId, seeded.operationId, seeded.revision]);
    const saving = tab.save(withLunchWave(loaded, "C"));
    const waiter = await waitingBehind(completion.pid, "save_teacher_schedule_preferences");
    check("the ordinary save waits behind the completion", waiter !== null && waiter !== completion.pid);
    check("...before it has touched teacher_schedule_preferences - the same lock order on both sides", waiter !== null && !(await relationsLockedBy(waiter)).includes(PREFERENCES));
    await completion.commit();
    check("...then succeeds", (await saving).ok);
    check(
      "one row: the newer lunch wave on top of the schedule the completion made active",
      (await countRows(PREFERENCES, teacher.membershipId)) === 1 && deepEqual(await preferences(teacher.membershipId), { lunch_wave: "C", active_bell_schedule_id: ownScheduleId(draft) }),
    );
    check("a retry of the completed operation is replayed", completedReplay(await teacher.repository.completeSetup(seeded.operationId, seeded.revision)));
  }

  console.log("\n6. Supplementary: both writers fired together, nothing held (not the ordering evidence)");
  {
    const ROUNDS = 6;
    let refused = 0;
    let landedOnTop = 0;
    let wrong = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const { teacher, seeded } = await teacherWithDraft(`free-${round}`, round % 2 === 0);
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
    console.log(`  (${ROUNDS} rounds, alternating existing and first row: completion refused ${refused}; ordinary write landed on top ${landedOnTop})`);
    check("every round ended one of those two ways, with no rejected write", wrong === 0 && refused + landedOnTop === ROUNDS);
  }

  console.log("\n7. Nothing of this run is left holding anything");
  {
    const memberships = (await db.admin<{ id: string }>("select id from public.organization_memberships where user_id = any($1::uuid[])", [createdUsers])).map((row) => row.id);
    const [locks] = await db.admin<{ count: number }>(
      `select count(*)::int as count from pg_locks l
       where l.locktype = 'advisory' and exists (
         select 1 from unnest($1::uuid[]) m
         where (l.classid::bigint << 32 | l.objid::bigint) = hashtextextended('onboarding_setup:' || m::text, 0)
       )`,
      [memberships],
    );
    check("no setup advisory lock of this run's teachers is still held", locks.count === 0);
    const [open] = await db.admin<{ count: number }>(
      "select count(*)::int as count from pg_stat_activity where state like 'idle in transaction%' and query ~ '(complete_setup|save_teacher_schedule_preferences|save_setup_draft|set_config)'",
    );
    check("no transaction of this kind was left open", open.count === 0);
  }
}

async function main() {
  const mode = process.argv.includes("--run") ? "run" : process.argv.includes("--cleanup-leftovers") ? "cleanup" : "check";
  const target = stagingTarget();
  console.log(`Target: ${target.label} (transaction pooler)`);
  const connected = await connectToStaging(target);
  db = connected.db;
  console.log(`Confirmed falcondeck-staging: PostgreSQL ${connected.facts.serverVersion}; ${connected.facts.authUsers} Auth users, all @example.test; onboarding migrations recorded`);
  console.log(`Pooler: ${connected.facts.backendsAcrossTransactions} distinct server backend(s) across 12 one-statement transactions on one client connection`);
  const leftovers = await leftoverFixtureUsers();
  if (leftovers.length) console.log(`Note: ${leftovers.length} fixture user(s) from an earlier run remain (--cleanup-leftovers removes them)`);

  if (mode === "check") {
    console.log("\nTarget check only; nothing was written. Pass --run to run the scenarios.");
    await db.close();
    return;
  }
  if (mode === "cleanup") {
    const removed = await deleteFixtures(leftovers);
    console.log(`\nRemoved ${removed.users} fixture user(s) and ${removed.organizations} fixture school(s).`);
    await db.close();
    return;
  }

  console.log(`\nRun ${RUN}\n`);
  const before = await fingerprint([], []);
  let scenarioError: unknown = null;
  try {
    await scenarios();
  } catch (error) {
    scenarioError = error;
  }

  console.log("\n8. Cleanup and untouched data");
  const organizations = await runOrganizations();
  const removed = await deleteFixtures(createdUsers).catch((error: Error) => {
    console.error(`FAIL  - cleanup: ${error.message}`);
    failures += 1;
    return null;
  });
  if (removed) check(`this run's ${createdUsers.length} fixture users and ${organizations.length} schools were removed`, removed.users === createdUsers.length && removed.organizations === organizations.length);
  const after = await fingerprint([], []);
  const changed = Object.keys({ ...before, ...after }).filter((table) => before[table] !== after[table]);
  check("every row outside this run's fixtures is unchanged (all school-scoped tables, organizations, auth.users)", changed.length === 0);
  if (changed.length) console.error(`  changed: ${changed.join(", ")} (if someone else used staging meanwhile, rerun)`);

  await db.close();
  if (scenarioError) throw scenarioError;
  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error: Error) => {
  // Message only: a driver error object can carry connection parameters.
  console.error(`\n${error?.message ?? "error"}`);
  await db?.close().catch(() => {});
  process.exit(1);
});
