/**
 * What a client bundle from BEFORE the onboarding foundation can still do to
 * an account that completes guided setup while that old tab stays open.
 *
 * The old bundle is the one Production served until e265b80 went live
 * (2026-10-17 00:04 UTC): commit ecb7467. Its save engine is taken from git
 * at that commit - not reimplemented - and run, as the teacher, under RLS,
 * against today's migrations and the real complete_setup(), on a throwaway
 * local PostgreSQL 17 server (scripts/support/testDatabase.ts). Nothing
 * touches Supabase.
 *
 * This is a reproduction, not a regression suite: a passing "reproduced"
 * check means the damage DID happen. Each damaging case is paired with the
 * current engine doing the same thing safely.
 *
 *   npm run verify:old-client-exposure
 *
 * Background: docs/ONBOARDING_SETUP_ARCHITECTURE.md §8.3 (writers outside the
 * protocol), §9.2 (cases A, B, B2), §11 limitation 10, §13 precondition 2.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";
import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import { SupabaseSetupRepository } from "@/lib/data/supabaseSetupRepository";
import type { AppData, SaveResult } from "@/lib/data/types";
import { createEmptySetupDraft } from "@/lib/onboarding/setupDraft";
import { generateId } from "@/lib/store/id";
import type { SetupDraft, SetupSeed } from "@/types/setupDraft";
import { createTestDatabase, type RpcClient, type SelectBuilder, type TestDatabase } from "./support/testDatabase";

/** Production's last client before the foundation deploy (e265b80's first parent). */
const PRE_FOUNDATION_COMMIT = "ecb7467";
/** The old engine's runtime imports are these three files; everything else it imports is type-only. */
const ENGINE_FILES = ["supabaseDataRepository.ts", "supabaseMapping.ts", "scopedCloudId.ts"];
const EMPTY_SEED: SetupSeed = { activeBellScheduleId: null, lunchWave: "none" };

interface Engine {
  load(): Promise<AppData>;
  save(data: AppData): Promise<SaveResult>;
}
type EngineConstructor = new (client: unknown, ctx: { organizationId: string; membershipId: string }) => Engine;

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}
function precondition(label: string, holds: boolean) {
  if (!holds) throw new Error(`precondition failed: ${label}`);
}

let db: TestDatabase;
let OldEngine: EngineConstructor;
let engineDir: string | null = null;

async function loadPreFoundationEngine(): Promise<EngineConstructor> {
  engineDir = mkdtempSync(join(tmpdir(), "falcon-old-client-"));
  for (const file of ENGINE_FILES) {
    const source = execFileSync("git", ["show", `${PRE_FOUNDATION_COMMIT}:lib/data/${file}`], { encoding: "utf8" });
    writeFileSync(join(engineDir, file), source);
  }
  const source = execFileSync("git", ["show", `${PRE_FOUNDATION_COMMIT}:lib/data/supabaseDataRepository.ts`], { encoding: "utf8" });
  precondition("the old engine writes teacher_schedule_preferences directly, whole-row", source.includes('.from("teacher_schedule_preferences")') && source.includes("upsert(Map_.teacherSchedulePreferencesToRow"));
  precondition("the old engine predates the preferences RPC", !source.includes("save_teacher_schedule_preferences"));
  precondition("the old engine drops its baseline after a failed save", source.includes("this.lastSnapshot = null;"));
  const loaded = (await import(pathToFileURL(join(engineDir, "supabaseDataRepository.ts")).href)) as { SupabaseDataRepository?: EngineConstructor };
  if (!loaded.SupabaseDataRepository) throw new Error(`no SupabaseDataRepository at ${PRE_FOUNDATION_COMMIT}`);
  return loaded.SupabaseDataRepository;
}

interface Teacher {
  userId: string;
  organizationId: string;
  membershipId: string;
  client: RpcClient;
}

async function newFounder(label: string): Promise<Teacher> {
  const userId = await db.createUser(`${label}@example.test`);
  const client = db.clientFor(userId);
  const { error } = await client.rpc("bootstrap_organization", { organization_name: `${label} School` });
  if (error) throw new Error(error.message);
  const [row] = await db.admin<{ id: string; organization_id: string }>("select id, organization_id from public.organization_memberships where user_id = $1", [userId]);
  return { userId, organizationId: row.organization_id, membershipId: row.id, client };
}

async function newJoinerOfSchoolWithSharedSchedule(label: string, scheduleId: string): Promise<Teacher> {
  const school = await newFounder(`${label}-school`);
  await db.admin(
    `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source)
     values ($1, $2, 'organization', null, 'Regular Day', true, 'built-in')`,
    [scheduleId, school.organizationId],
  );
  await db.admin(
    `insert into public.schedule_blocks (id, bell_schedule_id, organization_id, owner_type, owner_membership_id, position, label, kind, start_time, end_time)
     values ($1 || ':p1', $1, $2, 'organization', null, 0, '1st Hour', 'instructional', '08:00', '08:50')`,
    [scheduleId, school.organizationId],
  );
  const userId = await db.createUser(`${label}@example.test`);
  const client = db.clientFor(userId);
  const { error } = await client.rpc("join_existing_school", { target_organization_id: school.organizationId });
  if (error) throw new Error(error.message);
  const [row] = await db.admin<{ id: string }>("select id from public.organization_memberships where user_id = $1", [userId]);
  return { userId, organizationId: school.organizationId, membershipId: row.id, client };
}

const ctxOf = (teacher: Teacher) => ({ organizationId: teacher.organizationId, membershipId: teacher.membershipId });
const oldTab = (teacher: Teacher, client: RpcClient = teacher.client): Engine => new OldEngine(client, ctxOf(teacher));
const currentTab = (teacher: Teacher, client: RpcClient = teacher.client): Engine =>
  new SupabaseDataRepository(client as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0], ctxOf(teacher));

function ownScheduleDraft(): SetupDraft {
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
    lunchWave: "B",
    firstLesson: { id: generateId("lesson"), date: "2026-10-12", classSectionId: sectionId, learningTarget: "I can.", agendaItems: [], resources: [], announcements: [] },
  };
}

function sharedScheduleDraft(scheduleId: string): SetupDraft {
  const draft = ownScheduleDraft();
  return {
    ...draft,
    schedule: {
      mode: "shared",
      scheduleId,
      expectedBlocks: [{ id: "p1", label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", customKindLabel: null, isLunchWindow: false, overrides: [] }],
      assignments: [{ id: crypto.randomUUID(), blockId: "p1", classSectionId: draft.classSections[0].id }],
    },
  };
}

const ownScheduleId = (draft: SetupDraft) => (draft.schedule?.mode === "own" ? draft.schedule.id : "");

async function seedDraft(teacher: Teacher, draft: SetupDraft, seed: SetupSeed = EMPTY_SEED): Promise<{ operationId: string; revision: number }> {
  const saved = await new SupabaseSetupRepository(teacher.client, teacher.organizationId).saveDraft(null, draft, seed);
  if (!saved.ok || saved.value.status !== "saved") throw new Error("could not save the draft");
  return { operationId: saved.value.operationId, revision: saved.value.revision };
}

async function completeGuidedSetup(teacher: Teacher, draft: SetupDraft): Promise<void> {
  const { operationId, revision } = await seedDraft(teacher, draft);
  const completed = await new SupabaseSetupRepository(teacher.client, teacher.organizationId).completeSetup(operationId, revision);
  if (!completed.ok || completed.value.status !== "completed") throw new Error("setup did not complete");
}

async function count(table: string, membershipId: string): Promise<number> {
  const [row] = await db.admin<{ count: number }>(`select count(*)::int as count from public.${table} where owner_membership_id = $1`, [membershipId]);
  return row.count;
}

async function preferences(membershipId: string): Promise<{ lunch_wave: string; active_bell_schedule_id: string | null } | null> {
  const rows = await db.admin<{ lunch_wave: string; active_bell_schedule_id: string | null }>(
    "select lunch_wave, active_bell_schedule_id from public.teacher_schedule_preferences where owner_membership_id = $1",
    [membershipId],
  );
  return rows[0] ?? null;
}

async function setupRows(membershipId: string) {
  return {
    classes: await count("class_sections", membershipId),
    lessons: await count("lessons", membershipId),
    lessonLinks: await count("lesson_class_sections", membershipId),
    assignments: await count("teacher_period_assignments", membershipId),
    schedules: await count("bell_schedules", membershipId),
  };
}

async function completionRecorded(membershipId: string): Promise<boolean> {
  return (await db.admin("select 1 from public.setup_completions where owner_membership_id = $1", [membershipId])).length === 1;
}

const withLunchWave = (data: AppData, lunchWave: AppData["teacherSchedulePreferences"]["lunchWave"]): AppData => ({
  ...data,
  teacherSchedulePreferences: { ...data.teacherSchedulePreferences, lunchWave },
});

function withOwnClass(data: AppData, name: string): { data: AppData; sectionId: string } {
  const courseId = generateId("course");
  const sectionId = generateId("section");
  return {
    sectionId,
    data: { ...data, courses: [...data.courses, { id: courseId, name }], classSections: [...data.classSections, { id: sectionId, courseId, name: `${name} - 1st Hour` }] },
  };
}

/** The next direct write to `table` (old engine) or RPC for it (current engine) fails once, as a dropped request would. */
function flakyClient(client: RpcClient, table: string): { client: RpcClient; failNext: () => void } {
  let armed = false;
  const failed = { data: null, error: { message: "TypeError: Failed to fetch" } };
  const fail = (builder: SelectBuilder): SelectBuilder =>
    ({ ...builder, eq: () => fail(builder), select: () => fail(builder), then: (resolve: (value: typeof failed) => unknown) => Promise.resolve(failed).then(resolve) }) as SelectBuilder;
  return {
    failNext: () => {
      armed = true;
    },
    client: {
      async rpc(name, args) {
        if (armed && table === "teacher_schedule_preferences" && name === "save_teacher_schedule_preferences") {
          armed = false;
          return failed;
        }
        return client.rpc(name, args);
      },
      from(name) {
        const builder = client.from(name);
        if (name !== table) return builder;
        const intercept = <Args extends unknown[]>(method: (...args: Args) => SelectBuilder) =>
          (...args: Args): SelectBuilder => {
            if (!armed) return method(...args);
            armed = false;
            return fail(builder);
          };
        builder.upsert = intercept(builder.upsert.bind(builder));
        builder.update = intercept(builder.update.bind(builder));
        builder.delete = intercept(builder.delete.bind(builder));
        return builder;
      },
    },
  };
}

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

async function waitingBehind(holderPid: number, pattern: string): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await db.admin("select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ~ $1 and $2 = any (pg_blocking_pids(pid))", [pattern, holderPid]);
    if (rows.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function main() {
  OldEngine = await loadPreFoundationEngine();
  db = await createTestDatabase();
  console.log(`Old client: SupabaseDataRepository at ${PRE_FOUNDATION_COMMIT} (Production until 2026-10-17 00:04 UTC)\n`);

  console.log("1. Old tab, loaded before setup, changes its lunch wave after setup completed elsewhere (§9.2 case A)");
  {
    const teacher = await newFounder("old-a");
    const tab = oldTab(teacher);
    const loaded = await tab.load();
    const draft = ownScheduleDraft();
    await completeGuidedSetup(teacher, draft);
    precondition("setup made its own schedule active", (await preferences(teacher.membershipId))?.active_bell_schedule_id === ownScheduleId(draft));
    const result = await tab.save(withLunchWave(loaded, "A"));
    const after = await preferences(teacher.membershipId);
    check("the old tab's save is reported as a success", result.ok);
    check("REPRODUCED: the active schedule set by setup is cleared (null)", after?.active_bell_schedule_id === null);
    check("...the lunch wave from setup ('B') is replaced by the old tab's", after?.lunch_wave === "A");
    const rows = await setupRows(teacher.membershipId);
    check("...setup's class, schedule and lesson rows themselves remain", rows.classes === 1 && rows.schedules === 1 && rows.lessons === 1);
    check("...setup is still recorded as completed", await completionRecorded(teacher.membershipId));

    const control = await newFounder("current-a");
    const controlTab = currentTab(control);
    const controlLoaded = await controlTab.load();
    const controlDraft = ownScheduleDraft();
    await completeGuidedSetup(control, controlDraft);
    await controlTab.save(withLunchWave(controlLoaded, "A"));
    check("control, current engine: the active schedule survives", (await preferences(control.membershipId))?.active_bell_schedule_id === ownScheduleId(controlDraft));
  }

  console.log("\n2. Old tab: one failed save, then any later save (teacher uses the school's schedule; §9.2 case B)");
  {
    const scheduleId = "schedule-shared-old-b";
    const teacher = await newJoinerOfSchoolWithSharedSchedule("old-b", scheduleId);
    const flaky = flakyClient(teacher.client, "teacher_schedule_preferences");
    const tab = oldTab(teacher, flaky.client);
    const loaded = await tab.load();
    await completeGuidedSetup(teacher, sharedScheduleDraft(scheduleId));
    precondition("setup committed one class, one period assignment, one lesson", JSON.stringify(await setupRows(teacher.membershipId)) === JSON.stringify({ classes: 1, lessons: 1, lessonLinks: 1, assignments: 1, schedules: 0 }));
    const edited = withLunchWave(loaded, "A");
    flaky.failNext();
    precondition("the first save fails", !(await tab.save(edited)).ok);
    const retry = await tab.save(edited);
    const rows = await setupRows(teacher.membershipId);
    check("the retry is reported as a success", retry.ok);
    check("REPRODUCED: setup's class is deleted", rows.classes === 0);
    check("REPRODUCED: setup's period assignment is deleted", rows.assignments === 0);
    check("REPRODUCED: setup's first lesson is deleted", rows.lessons === 0 && rows.lessonLinks === 0);
    check("...while setup is still recorded as completed - so guided setup will not run again for this account", await completionRecorded(teacher.membershipId));
    check("...and the active schedule is cleared as well", (await preferences(teacher.membershipId))?.active_bell_schedule_id === null);

    const control = await newJoinerOfSchoolWithSharedSchedule("current-b", "schedule-shared-current-b");
    const controlFlaky = flakyClient(control.client, "teacher_schedule_preferences");
    const controlTab = currentTab(control, controlFlaky.client);
    const controlLoaded = await controlTab.load();
    await completeGuidedSetup(control, sharedScheduleDraft("schedule-shared-current-b"));
    controlFlaky.failNext();
    precondition("control: the first save fails", !(await controlTab.save(withLunchWave(controlLoaded, "A"))).ok);
    check("control, current engine: the retry succeeds and setup's class, assignment and lesson survive", (await controlTab.save(withLunchWave(controlLoaded, "A"))).ok && JSON.stringify(await setupRows(control.membershipId)) === JSON.stringify({ classes: 1, lessons: 1, lessonLinks: 1, assignments: 1, schedules: 0 }));
  }

  console.log("\n3. The same, teacher built their own schedule (§9.2 case B2)");
  {
    const teacher = await newFounder("old-b2");
    const flaky = flakyClient(teacher.client, "teacher_schedule_preferences");
    const tab = oldTab(teacher, flaky.client);
    const loaded = await tab.load();
    await completeGuidedSetup(teacher, ownScheduleDraft());
    const edited = withLunchWave(loaded, "A");
    flaky.failNext();
    precondition("the first save fails", !(await tab.save(edited)).ok);
    const retry = await tab.save(edited);
    check("REPRODUCED: the retry fails", !retry.ok);
    check("REPRODUCED: ...after setup's first lesson was already deleted", (await count("lessons", teacher.membershipId)) === 0);
    const later = await tab.save(withLunchWave(edited, "C"));
    check("REPRODUCED: every later save from that tab fails too", !later.ok && !(await tab.save(withLunchWave(edited, "none"))).ok);
    check("...setup's class and schedule remain", (await count("class_sections", teacher.membershipId)) === 1 && (await count("bell_schedules", teacher.membershipId)) === 1);
  }

  console.log("\n4. Old tab's preference save overlaps the completion; then the teacher keeps working in that tab");
  // The deployed old engine upserts the whole row (INSERT ... ON CONFLICT DO
  // UPDATE), not the plain UPDATE of the §8.2 control. Both rows below.
  for (const existingRow of [true, false]) {
    const label = existingRow ? "(existing row)" : "(first row)";
    const teacher = await newFounder(existingRow ? "old-overlap-existing" : "old-overlap-first");
    if (existingRow) {
      const prior = await teacher.client.rpc("save_teacher_schedule_preferences", { p_organization_id: teacher.organizationId, p_lunch_wave: "none", p_active_bell_schedule_id: null, p_changed_columns: ["lunch_wave"] });
      precondition("a preferences row exists before setup", prior.error === null && (await preferences(teacher.membershipId)) !== null);
    }
    const draft = ownScheduleDraft();
    const seeded = await seedDraft(teacher, draft);
    const flaky = flakyClient(teacher.client, "class_sections");
    const tab = oldTab(teacher, flaky.client);
    const loaded = await tab.load();

    const completion = await openUserTransaction(teacher.userId);
    const completed = await completion.connection.query<{ result: { status: string } }>("select public.complete_setup($1, $2, $3) as result", [teacher.organizationId, seeded.operationId, seeded.revision]);
    precondition("completion has completed, not yet committed", completed.rows[0].result.status === "completed");
    const overlapping = tab.save(withLunchWave(loaded, "A"));
    check(`${label} the old tab's whole-row upsert waits behind the completion`, await waitingBehind(completion.pid, "teacher_schedule_preferences"));
    await completion.commit();
    const first = await overlapping;
    const afterOverlap = await preferences(teacher.membershipId);
    check(`${label} it is NOT rejected: it succeeds once the completion commits`, first.ok);
    check(`${label} REPRODUCED: ...and clears the active schedule the completion just set (case A, through the overlap)`, afterOverlap?.active_bell_schedule_id === null && afterOverlap.lunch_wave === "A");

    // The teacher does not reload. A later edit with no failure leaves setup's rows alone...
    const art = withOwnClass(withLunchWave(loaded, "A"), "Art");
    check(`${label} a later save with no failure keeps setup's class and lesson`, (await tab.save(art.data)).ok && (await count("lessons", teacher.membershipId)) === 1);
    // ...but the first failed save from that tab, at any point later, arms the full re-read.
    const biology = withOwnClass(art.data, "Biology");
    flaky.failNext();
    precondition("a later save fails once", !(await tab.save(biology.data)).ok);
    await tab.save(biology.data);
    check(`${label} REPRODUCED: the save after that failure deletes setup's first lesson`, (await count("lessons", teacher.membershipId)) === 0);
    check(`${label} ...while setup stays recorded as completed`, await completionRecorded(teacher.membershipId));
  }

  console.log("\n5. What an old tab does NOT damage on its own");
  {
    const teacher = await newFounder("old-quiet");
    const tab = oldTab(teacher);
    const loaded = await tab.load();
    const draft = ownScheduleDraft();
    await completeGuidedSetup(teacher, draft);
    const noEdit = await tab.save(structuredClone(loaded));
    check("a save with no edits writes nothing: setup's preferences and rows unchanged", noEdit.ok && (await preferences(teacher.membershipId))?.active_bell_schedule_id === ownScheduleId(draft) && (await setupRows(teacher.membershipId)).lessons === 1);
    const added = withOwnClass(loaded, "Art");
    const addClass = await tab.save(added.data);
    const rows = await setupRows(teacher.membershipId);
    check("an edit that does not touch preferences, with no failed save, keeps setup's rows and active schedule", addClass.ok && rows.classes === 2 && rows.lessons === 1 && (await preferences(teacher.membershipId))?.active_bell_schedule_id === ownScheduleId(draft));
    console.log("  (so the damage needs, in that open old tab: a preferences edit (case A, also when it overlaps the completion), or any failed save followed by any save (B, B2, 4))");
  }

  await db.close();
  if (engineDir) rmSync(engineDir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "All checks passed (every REPRODUCED line means the old client caused that damage)." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db?.close().catch(() => {});
  if (engineDir) rmSync(engineDir, { recursive: true, force: true });
  process.exit(1);
});
