/**
 * HTTP integration checks for the onboarding setup RPCs and the ordinary
 * schedule-preference write, through Supabase Auth and PostgREST: real
 * supabase-js, real sign-up, the production repositories
 * (SupabaseDataRepository, SupabaseSetupRepository).
 *
 * Runs only against a throwaway local stack - every URL must be on this
 * machine (scripts/integration/localStack.ts). Not part of `npm run verify`.
 * Setup, variables, fixtures and cleanup: docs/ONBOARDING_SETUP_INTEGRATION.md.
 *
 *   npm run integration:onboarding-setup-http
 *
 * Fixtures are created per run: new users signed up through Auth, their
 * schools bootstrapped through bootstrap_organization, and school schedules
 * inserted over the superuser database connection. Nothing is cleaned up;
 * the stack is discarded instead.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool, type PoolClient } from "pg";
import { readFileSync, statSync } from "node:fs";
import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import { SupabaseSetupRepository, type SetupRpcClient } from "@/lib/data/supabaseSetupRepository";
import { deepEqual } from "@/lib/data/supabaseMapping";
import type { AppData } from "@/lib/data/types";
import { createEmptySetupDraft } from "@/lib/onboarding/setupDraft";
import { generateId } from "@/lib/store/id";
import type { SetupDraft, SetupSeed } from "@/types/setupDraft";
import { createChecker, loadLocalStackConfig } from "./localStack";

const config = loadLocalStackConfig();
const admin = new Pool({ connectionString: config.databaseUrl, max: 8 });
const checker = createChecker();
const check = checker.check;
// Only gateway traffic from this run is examined.
const gatewayLogStart = config.gatewayLog ? statSync(config.gatewayLog).size : 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function anonClient(): SupabaseClient {
  return createClient(config.supabaseUrl, config.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

interface Teacher {
  label: string;
  userId: string;
  client: SupabaseClient;
  organizationId: string;
  membershipId: string;
  setup: SupabaseSetupRepository;
}

async function signUpFounder(label: string): Promise<Teacher> {
  const client = anonClient();
  const email = `${label}-${Date.now()}@example.test`;
  const { data, error } = await client.auth.signUp({ email, password: `local-${crypto.randomUUID()}` });
  if (error || !data.session || !data.user) throw new Error(`sign-up failed: ${error?.message}`);
  const boot = await client.rpc("bootstrap_organization", { organization_name: `${label} School` });
  if (boot.error) throw new Error(`bootstrap_organization failed: ${boot.error.message}`);
  const { data: rows, error: readError } = await client.from("organization_memberships").select("id, organization_id").eq("user_id", data.user.id);
  if (readError || !rows || rows.length !== 1) throw new Error(`membership read failed: ${readError?.message}`);
  return {
    label,
    userId: data.user.id,
    client,
    organizationId: rows[0].organization_id as string,
    membershipId: rows[0].id as string,
    setup: new SupabaseSetupRepository(client as unknown as SetupRpcClient, rows[0].organization_id as string),
  };
}

function tab(t: Teacher): SupabaseDataRepository {
  return new SupabaseDataRepository(t.client as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0], {
    organizationId: t.organizationId,
    membershipId: t.membershipId,
  });
}

function withPrefs(data: AppData, prefs: Partial<AppData["teacherSchedulePreferences"]>): AppData {
  return { ...data, teacherSchedulePreferences: { ...data.teacherSchedulePreferences, ...prefs } };
}

async function orgSchedule(organizationId: string, name: string): Promise<string> {
  const id = generateId("schedule");
  await admin.query(
    `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source)
     values ($1, $2, 'organization', null, $3, false, 'built-in')`,
    [id, organizationId, name],
  );
  await admin.query(
    `insert into public.schedule_blocks (id, bell_schedule_id, organization_id, owner_type, owner_membership_id, position, label, kind, start_time, end_time)
     values ($1 || ':p1', $1, $2, 'organization', null, 0, '1st Hour', 'instructional', '08:00', '08:50')`,
    [id, organizationId],
  );
  return id;
}

async function storedPrefs(membershipId: string): Promise<{ active_bell_schedule_id: string | null; lunch_wave: string } | null> {
  const r = await admin.query("select active_bell_schedule_id, lunch_wave from public.teacher_schedule_preferences where owner_membership_id = $1", [membershipId]);
  return r.rows[0] ?? null;
}

async function count(table: string, membershipId: string): Promise<number> {
  const r = await admin.query(`select count(*)::int as n from public.${table} where owner_membership_id = $1`, [membershipId]);
  return r.rows[0].n as number;
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

async function seedOf(t: Teacher): Promise<SetupSeed> {
  const s = await t.setup.getState();
  if (!s.ok || s.value.status !== "not-started") throw new Error(`expected not-started: ${JSON.stringify(s)}`);
  return s.value.seed;
}

/** A transaction opened directly as the user (authenticated role + claims), held open by the test. */
async function openAs(userId: string): Promise<{ c: PoolClient; pid: number; commit: () => Promise<void> }> {
  const c = await admin.connect();
  await c.query("begin isolation level read committed");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  const pid = (await c.query("select pg_backend_pid() as pid")).rows[0].pid as number;
  return { c, pid, commit: async () => { await c.query("commit"); c.release(); } };
}

/** The PostgREST backend (connected as `authenticator`) waiting on a lock held by holderPid. */
async function restWaiterBehind(holderPid: number, pattern: string): Promise<number | null> {
  for (let i = 0; i < 200; i += 1) {
    const r = await admin.query(
      `select pid from pg_stat_activity where usename = 'authenticator' and wait_event_type = 'Lock'
       and query ~ $1 and $2 = any (pg_blocking_pids(pid))`,
      [pattern, holderPid],
    );
    if (r.rows[0]) return r.rows[0].pid as number;
    await sleep(25);
  }
  return null;
}

async function relationsLockedBy(pid: number): Promise<string[]> {
  const r = await admin.query("select distinct relation::regclass::text as rel from pg_locks where pid = $1 and relation is not null", [pid]);
  return r.rows.map((row) => row.rel as string);
}

async function main() {
  console.log("1. Ordinary schedule and lunch-wave saves (SupabaseDataRepository over PostgREST)");
  {
    const t = await signUpFounder("ordinary");
    const scheduleId = await orgSchedule(t.organizationId, "Regular Day");
    const repo = tab(t);
    const loaded = await repo.load();
    check("load(): a new account starts with no schedule chosen", loaded.teacherSchedulePreferences.activeBellScheduleId === null);
    await repo.save(withPrefs(loaded, { activeBellScheduleId: scheduleId, lunchWave: "B" }));
    check("first save creates the row with both values", JSON.stringify(await storedPrefs(t.membershipId)) === JSON.stringify({ active_bell_schedule_id: scheduleId, lunch_wave: "B" }), await storedPrefs(t.membershipId));
    const reread = await tab(t).load();
    check("a fresh repository reads both values back", reread.teacherSchedulePreferences.activeBellScheduleId === scheduleId && reread.teacherSchedulePreferences.lunchWave === "B");
    await repo.save(withPrefs(reread, { lunchWave: "C" }));
    const after = await storedPrefs(t.membershipId);
    check("a lunch-wave-only save updates only the lunch wave", after?.lunch_wave === "C" && after?.active_bell_schedule_id === scheduleId, after);
    const other = await orgSchedule(t.organizationId, "Late Start");
    await repo.save(withPrefs(await tab(t).load(), { activeBellScheduleId: other }));
    const after2 = await storedPrefs(t.membershipId);
    check("a schedule-only save updates only the schedule", after2?.active_bell_schedule_id === other && after2?.lunch_wave === "C", after2);
    const direct = await t.client.rpc("save_teacher_schedule_preferences", {
      p_organization_id: t.organizationId, p_lunch_wave: "A", p_active_bell_schedule_id: null, p_changed_columns: ["lunch_wave"],
    });
    check("the RPC accepts a JSON array for text[] p_changed_columns", direct.error === null && (await storedPrefs(t.membershipId))?.lunch_wave === "A", direct.error);
    const bad = await t.client.rpc("save_teacher_schedule_preferences", {
      p_organization_id: t.organizationId, p_lunch_wave: "A", p_active_bell_schedule_id: null, p_changed_columns: ["owner_membership_id"],
    });
    check("an unknown column name is refused (22023)", bad.error?.code === "22023", bad.error);
  }

  console.log("2. Draft creation, resume, revision conflict, completion, replay");
  {
    const t = await signUpFounder("draft");
    const seed = await seedOf(t);
    check("not-started: eligible, empty seed", JSON.stringify(seed) === JSON.stringify({ activeBellScheduleId: null, lunchWave: "none" }), seed);
    const draft = completeDraft();
    const created = await t.setup.saveDraft(null, draft, seed);
    check("create: saved at revision 1", created.ok && created.value.status === "saved" && created.value.revision === 1, created);
    if (!created.ok || created.value.status !== "saved") throw new Error("cannot continue");
    const { operationId } = created.value;
    const resumed = await t.setup.getState();
    check("resume: in-progress with the same payload", resumed.ok && resumed.value.status === "in-progress" && deepEqual(resumed.value.draft.payload, draft), resumed.ok ? resumed.value.status : resumed);
    const revised = await t.setup.saveDraft(1, { ...draft, lunchWave: "none" }, null);
    check("revise: saved at revision 2", revised.ok && revised.value.status === "saved" && revised.value.revision === 2, revised);
    const stale = await t.setup.saveDraft(1, draft, null);
    check("stale revision: conflict carrying the stored draft at revision 2", stale.ok && stale.value.status === "conflict" && stale.value.reason === "stale-revision" && "draft" in stale.value && stale.value.draft.revision === 2, stale);
    const twice = await t.setup.saveDraft(null, draft, seed);
    check("second create: conflict draft-exists", twice.ok && twice.value.status === "conflict" && twice.value.reason === "draft-exists", twice);
    const staleComplete = await t.setup.completeSetup(operationId, 1);
    check("complete at a stale revision: conflict, nothing written", staleComplete.ok && staleComplete.value.status === "conflict" && (await count("courses", t.membershipId)) === 0, staleComplete);
    const done = await t.setup.completeSetup(operationId, 2);
    check("complete: completed, not replayed", done.ok && done.value.status === "completed" && !done.value.replayed, done);
    check("complete: rows written once, draft deleted", (await count("courses", t.membershipId)) === 1 && (await count("class_sections", t.membershipId)) === 1 && (await count("lessons", t.membershipId)) === 1 && (await count("setup_drafts", t.membershipId)) === 0);
    const replay = await t.setup.completeSetup(operationId, 2);
    check("replay: completed, replayed, same result", replay.ok && replay.value.status === "completed" && replay.value.replayed && done.ok && replay.value.status === "completed" && done.value.status === "completed" && JSON.stringify(replay.value.completion) === JSON.stringify(done.value.completion), replay);
    check("replay: nothing written twice", (await count("courses", t.membershipId)) === 1 && (await count("lessons", t.membershipId)) === 1);
    const state = await t.setup.getState();
    check("get_setup_state: completed", state.ok && state.value.status === "completed", state);
    const after = await t.setup.saveDraft(null, draft, seed);
    check("save after completion: answers completed, creates nothing", after.ok && after.value.status === "completed" && (await count("setup_drafts", t.membershipId)) === 0, after);
    // A later ordinary save must not disturb replay.
    const repo = tab(t);
    await repo.save(withPrefs(await repo.load(), { lunchWave: "B" }));
    const replay2 = await t.setup.completeSetup(operationId, 2);
    check("replay after a later ordinary save: still the stored result", replay2.ok && replay2.value.status === "completed" && replay2.value.replayed && (await storedPrefs(t.membershipId))?.lunch_wave === "B", replay2);
  }

  console.log("3. Preferences changed before the first draft save");
  {
    const t = await signUpFounder("seedgap");
    const seed = await seedOf(t);
    const repo = tab(t);
    await repo.save(withPrefs(await repo.load(), { lunchWave: "C" }));
    const refused = await t.setup.saveDraft(null, completeDraft(), seed);
    check("create with the old seed: preferences-changed with the current values", refused.ok && refused.value.status === "conflict" && refused.value.reason === "preferences-changed" && "preferences" in refused.value && JSON.stringify(refused.value.preferences) === JSON.stringify({ activeBellScheduleId: null, lunchWave: "C" }), refused);
    check("nothing was created", (await count("setup_drafts", t.membershipId)) === 0);
    const adopted = await t.setup.saveDraft(null, completeDraft("C"), { activeBellScheduleId: null, lunchWave: "C" });
    check("create with the reported seed: saved", adopted.ok && adopted.value.status === "saved", adopted);
    const baseline = (await admin.query("select baseline_lunch_wave from public.setup_drafts where owner_membership_id = $1", [t.membershipId])).rows[0];
    check("baseline is the stored value, read by the server", baseline?.baseline_lunch_wave === "C", baseline);
    const missing = await signUpFounder("noseed");
    const noSeed = await missing.setup.saveDraft(null, completeDraft(), null);
    check("create without a seed: rejected (22023)", !noSeed.ok && noSeed.kind === "rejected", noSeed);
  }

  console.log("4. Preferences changed before completion");
  {
    const t = await signUpFounder("precomplete");
    const seed = await seedOf(t);
    const created = await t.setup.saveDraft(null, completeDraft("A"), seed);
    if (!created.ok || created.value.status !== "saved") throw new Error("cannot continue");
    const repo = tab(t);
    await repo.save(withPrefs(await repo.load(), { lunchWave: "B" }));
    const refused = await t.setup.completeSetup(created.value.operationId, 1);
    check("complete: preferences-changed with the newer values", refused.ok && refused.value.status === "conflict" && refused.value.reason === "preferences-changed" && "preferences" in refused.value && refused.value.preferences.lunchWave === "B", refused);
    check("nothing operational written; newer value stands", (await count("courses", t.membershipId)) === 0 && (await storedPrefs(t.membershipId))?.lunch_wave === "B");
    const revised = await t.setup.saveDraft(1, completeDraft("B"), null);
    if (!revised.ok || revised.value.status !== "saved") throw new Error("cannot revise");
    const done = await t.setup.completeSetup(created.value.operationId, 2);
    check("after adopting the newer lunch wave: completed", done.ok && done.value.status === "completed", done);
  }

  console.log("5. Anonymous and cross-owner access");
  {
    const a = await signUpFounder("ownerA");
    const b = await signUpFounder("ownerB");
    await tab(a).save(withPrefs(await tab(a).load(), { lunchWave: "A" }));
    const seedA = await seedOf(a);
    const draftA = await a.setup.saveDraft(null, completeDraft("A"), seedA);
    if (!draftA.ok || draftA.value.status !== "saved") throw new Error(`cannot seed A: ${JSON.stringify(draftA)}`);
    // Created after A's draft: a private schedule makes A ineligible, by design.
    const aSchedulePrivate = generateId("schedule");
    await admin.query(
      `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source)
       values ($1, $2, 'teacher', $3, 'A private', false, 'custom')`,
      [aSchedulePrivate, a.organizationId, a.membershipId],
    );

    const anon = anonClient();
    for (const [name, args] of [
      ["get_setup_state", { p_organization_id: a.organizationId }],
      ["save_setup_draft", { p_organization_id: a.organizationId, p_expected_revision: null, p_payload: {}, p_expected_preferences: seedA }],
      ["complete_setup", { p_organization_id: a.organizationId, p_operation_id: draftA.value.operationId, p_expected_revision: 1 }],
      ["save_teacher_schedule_preferences", { p_organization_id: a.organizationId, p_lunch_wave: "C", p_active_bell_schedule_id: null, p_changed_columns: ["lunch_wave"] }],
      ["lock_own_membership", { p_organization_id: a.organizationId }],
    ] as const) {
      const r = await anon.rpc(name, args);
      check(`anon ${name}: rejected (${r.error?.code})`, r.error !== null && r.data === null, r);
    }
    for (const table of ["setup_drafts", "setup_completions"]) {
      const r = await anon.from(table).select("*");
      check(`anon select ${table}: refused`, r.error !== null, r.error);
      const rb = await b.client.from(table).select("*");
      check(`authenticated select ${table}: refused (no client privileges)`, rb.error !== null, rb.error);
    }
    const anonPrefs = await anon.from("teacher_schedule_preferences").select("*");
    check("anon read of teacher_schedule_preferences: no rows", anonPrefs.error !== null || (anonPrefs.data ?? []).length === 0, anonPrefs);

    const bReadsA = await b.client.from("teacher_schedule_preferences").select("*").eq("owner_membership_id", a.membershipId);
    check("B cannot read A's preferences", bReadsA.error === null && (bReadsA.data ?? []).length === 0, bReadsA);
    const bPatchA = await b.client.from("teacher_schedule_preferences").update({ lunch_wave: "C" }).eq("owner_membership_id", a.membershipId).select();
    check("B's direct PATCH of A's row changes nothing", (bPatchA.data ?? []).length === 0 && (await storedPrefs(a.membershipId))?.lunch_wave === "A", bPatchA);
    const bRpcInA = await b.client.rpc("save_teacher_schedule_preferences", { p_organization_id: a.organizationId, p_lunch_wave: "C", p_active_bell_schedule_id: null, p_changed_columns: ["lunch_wave"] });
    check(`B save_teacher_schedule_preferences in A's organization: rejected (${bRpcInA.error?.code})`, bRpcInA.error?.code === "42501" && (await storedPrefs(a.membershipId))?.lunch_wave === "A", bRpcInA.error);
    const bUsesAPrivate = await b.client.rpc("save_teacher_schedule_preferences", { p_organization_id: b.organizationId, p_lunch_wave: "none", p_active_bell_schedule_id: aSchedulePrivate, p_changed_columns: ["active_bell_schedule_id"] });
    check(`B activating A's private schedule: rejected (${bUsesAPrivate.error?.code})`, bUsesAPrivate.error !== null && (await storedPrefs(b.membershipId)) === null, bUsesAPrivate.error);
    const bSetupInA = new SupabaseSetupRepository(b.client as unknown as SetupRpcClient, a.organizationId);
    const bState = await bSetupInA.getState();
    check("B get_setup_state in A's organization: rejected", !bState.ok, bState);
    const bComplete = await bSetupInA.completeSetup(draftA.value.operationId, 1);
    check("B complete_setup with A's operation in A's organization: rejected", !bComplete.ok, bComplete);
    const bOwnComplete = await b.setup.completeSetup(draftA.value.operationId, 1);
    check("B complete_setup with A's operation id in B's organization: not completed", !(bOwnComplete.ok && bOwnComplete.value.status === "completed"), bOwnComplete);
    check("A's draft is untouched", (await count("setup_drafts", a.membershipId)) === 1 && (await count("courses", a.membershipId)) === 0);
    const execAnon = (await admin.query(
      `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('get_setup_state','save_setup_draft','complete_setup','save_teacher_schedule_preferences','lock_own_membership') order by 1`,
    )).rows;
    check("under Supabase default privileges, anon still cannot execute any of the five", execAnon.every((r) => !r.anon_exec) && execAnon.length === 5, execAnon);
    check("authenticated can execute all five", execAnon.every((r) => r.auth_exec), execAnon);
  }

  console.log("6. Lock order through PostgREST (one side held open directly, the other over HTTP)");
  {
    // (a) completion held open, ordinary save over HTTP, existing row.
    const t = await signUpFounder("lockA");
    const repo = tab(t);
    await repo.save(withPrefs(await repo.load(), { lunchWave: "A" }));
    const seed = await seedOf(t);
    const created = await t.setup.saveDraft(null, completeDraft("A"), seed);
    if (!created.ok || created.value.status !== "saved") throw new Error("seed failed");
    const loaded = await repo.load();
    const held = await openAs(t.userId);
    const r = await held.c.query("select public.complete_setup($1, $2, $3) as r", [t.organizationId, created.value.operationId, 1]);
    check("(a) completion done, not committed", r.rows[0].r.status === "completed");
    const saving = repo.save(withPrefs(loaded, { lunchWave: "C" }));
    const waiter = await restWaiterBehind(held.pid, "save_teacher_schedule_preferences");
    check("(a) the PostgREST request waits behind the completion", waiter !== null);
    if (waiter !== null) check("(a) ...without having touched teacher_schedule_preferences", !(await relationsLockedBy(waiter)).includes("teacher_schedule_preferences"), await relationsLockedBy(waiter));
    await held.commit();
    let saveError: unknown = null;
    await saving.catch((e) => { saveError = e; });
    check("(a) the HTTP save then succeeds (no 42501)", saveError === null, String(saveError));
    const p = await storedPrefs(t.membershipId);
    check("(a) the newer lunch wave lands on top of the completion's schedule", p?.lunch_wave === "C" && p.active_bell_schedule_id !== null, p);
    const replay = await t.setup.completeSetup(created.value.operationId, 1);
    check("(a) the completion still replays", replay.ok && replay.value.status === "completed" && replay.value.replayed, replay);

    // (b) ordinary write held open, completion over HTTP.
    const u = await signUpFounder("lockB");
    const useed = await seedOf(u);
    const ucreated = await u.setup.saveDraft(null, completeDraft("none"), useed);
    if (!ucreated.ok || ucreated.value.status !== "saved") throw new Error("seed failed");
    const uheld = await openAs(u.userId);
    await uheld.c.query("select public.save_teacher_schedule_preferences($1, 'B', null, array['lunch_wave'])", [u.organizationId]);
    const completing = u.setup.completeSetup(ucreated.value.operationId, 1);
    const uwaiter = await restWaiterBehind(uheld.pid, "complete_setup");
    check("(b) the PostgREST completion waits behind the ordinary first-row write", uwaiter !== null);
    if (uwaiter !== null) check("(b) ...without having touched teacher_schedule_preferences", !(await relationsLockedBy(uwaiter)).includes("teacher_schedule_preferences"), await relationsLockedBy(uwaiter));
    await uheld.commit();
    const out = await completing;
    check("(b) then answers preferences-changed; nothing written; newer value stands", out.ok && out.value.status === "conflict" && out.value.reason === "preferences-changed" && (await count("courses", u.membershipId)) === 0 && (await storedPrefs(u.membershipId))?.lunch_wave === "B", out);

    // (c) completion creating the first row held open, ordinary first-row save over HTTP.
    const v = await signUpFounder("lockC");
    const vseed = await seedOf(v);
    const vcreated = await v.setup.saveDraft(null, completeDraft("none"), vseed);
    if (!vcreated.ok || vcreated.value.status !== "saved") throw new Error("seed failed");
    const vrepo = tab(v);
    const vloaded = await vrepo.load();
    const vheld = await openAs(v.userId);
    await vheld.c.query("select public.complete_setup($1, $2, $3)", [v.organizationId, vcreated.value.operationId, 1]);
    const vsaving = vrepo.save(withPrefs(vloaded, { lunchWave: "C" }));
    const vwaiter = await restWaiterBehind(vheld.pid, "save_teacher_schedule_preferences");
    check("(c) first-row HTTP save waits behind the completion", vwaiter !== null);
    if (vwaiter !== null) check("(c) ...without having touched teacher_schedule_preferences", !(await relationsLockedBy(vwaiter)).includes("teacher_schedule_preferences"), await relationsLockedBy(vwaiter));
    await vheld.commit();
    let vErr: unknown = null;
    await vsaving.catch((e) => { vErr = e; });
    const vp = await storedPrefs(v.membershipId);
    check("(c) then succeeds: one row, newer lunch wave on top", vErr === null && vp?.lunch_wave === "C" && (await count("teacher_schedule_preferences", v.membershipId)) === 1, { vErr: String(vErr), vp });
  }

  if (config.gatewayLog) {
    const traffic = readFileSync(config.gatewayLog).subarray(gatewayLogStart).toString("utf8");
    check("gateway saw the ordinary save as /rest/v1/rpc/save_teacher_schedule_preferences", traffic.includes("POST /rest/v1/rpc/save_teacher_schedule_preferences"));
    check("gateway saw no direct write to /rest/v1/teacher_schedule_preferences except the cross-owner PATCH probe", (traffic.match(/(POST|PATCH) \/rest\/v1\/teacher_schedule_preferences/g) ?? []).length === 1);
  } else {
    checker.skip("gateway traffic checks", "FALCON_INTEGRATION_GATEWAY_LOG not set");
  }

  await admin.end();
  console.log(checker.failures === 0 ? "\nAll HTTP integration checks passed." : `\n${checker.failures} check(s) FAILED.`);
  process.exit(checker.failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await admin.end().catch(() => {});
  process.exit(1);
});
