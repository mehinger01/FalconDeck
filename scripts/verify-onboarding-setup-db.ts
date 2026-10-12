/**
 * Database-level verification of guided setup's persistence foundation
 * (docs/ONBOARDING_SETUP_ARCHITECTURE.md) - the two onboarding_setup
 * migrations, exercised through the real SupabaseSetupRepository,
 * SetupDraftSession, and fetchAppData().
 *
 * ISOLATED BY CONSTRUCTION: runs against a throwaway local PostgreSQL 17
 * server (scripts/support/testDatabase.ts) that every migration in
 * supabase/migrations is applied to from scratch. It never reads
 * .env.local and never connects to anything but that local server - the
 * linked Supabase project is not touched, and the two new migrations are
 * not applied anywhere by running this.
 *
 * Requests here are issued one at a time, on purpose - each section checks
 * one rule. Genuinely overlapping requests are the subject of
 * scripts/verify-onboarding-setup-concurrency.ts.
 *
 *   npm run verify:onboarding-setup-db
 */

import { fetchAppData } from "@/lib/data/supabaseDataRepository";
import { deepEqual, scheduleBlockCloudId, scheduleBlockOverrideCloudId } from "@/lib/data/supabaseMapping";
import { SupabaseSetupRepository, type SetupRpcClient } from "@/lib/data/supabaseSetupRepository";
import type { AppData } from "@/lib/data/types";
import { getOnboardingStatus } from "@/lib/onboarding/getOnboardingStatus";
import {
  createEmptySetupDraft,
  createSetupDraftFromSeed,
  hasSharedScheduleChanged,
  projectSetupDraftToAppData,
  snapshotSharedBlocks,
  validateSetupDraft,
} from "@/lib/onboarding/setupDraft";
import { SetupDraftSession } from "@/lib/onboarding/setupDraftSession";
import { deriveSetupEntry } from "@/lib/onboarding/setupEntry";
import type { SetupState, StoredSetupDraft } from "@/lib/onboarding/setupRepository";
import { generateId } from "@/lib/store/id";
import type { SetupDraft } from "@/types/setupDraft";
import {
  FIXTURE_CLOUD_MEMBERSHIP_ID,
  FIXTURE_CLOUD_ORGANIZATION_ID,
  FIXTURE_CLOUD_USER_ID,
  FIXTURE_LEGACY_MEMBERSHIP_ID,
  FIXTURE_LEGACY_ORGANIZATION_ID,
  FIXTURE_LEGACY_USER_ID,
  createTestDatabase,
  listMigrationFiles,
  type RpcClient,
  type TestDatabase,
} from "./support/testDatabase";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const LESSON_DATE = "2026-10-12";
const SHARED_SCHEDULE_ID = "schedule-shared-regular";

interface Teacher {
  userId: string;
  organizationId: string;
  membershipId: string;
  client: RpcClient;
  repository: SupabaseSetupRepository;
}

let db: TestDatabase;

async function teacherFor(userId: string, organizationId: string): Promise<Teacher> {
  const [{ id: membershipId }] = await db.admin<{ id: string }>(
    "select id from public.organization_memberships where user_id = $1 and organization_id = $2",
    [userId, organizationId],
  );
  const client = db.clientFor(userId);
  return { userId, organizationId, membershipId, client, repository: new SupabaseSetupRepository(client, organizationId) };
}

/** A brand-new account that founds its own school - through the real bootstrap_organization RPC. */
async function newFounder(label: string): Promise<Teacher> {
  const userId = await db.createUser(`${label}@example.test`);
  const { error } = await db.clientFor(userId).rpc("bootstrap_organization", { organization_name: `${label} School` });
  if (error) throw new Error(`bootstrap_organization failed: ${error.message}`);
  const [{ organization_id }] = await db.admin<{ organization_id: string }>(
    "select organization_id from public.organization_memberships where user_id = $1",
    [userId],
  );
  return teacherFor(userId, organization_id);
}

/** A brand-new account that joins an existing school - through the real join_existing_school RPC. */
async function newJoiner(label: string, organizationId: string): Promise<Teacher> {
  const userId = await db.createUser(`${label}@example.test`);
  const { error } = await db.clientFor(userId).rpc("join_existing_school", { target_organization_id: organizationId });
  if (error) throw new Error(`join_existing_school failed: ${error.message}`);
  return teacherFor(userId, organizationId);
}

function loadAppData(teacher: Teacher): Promise<AppData> {
  return fetchAppData(teacher.client as unknown as Parameters<typeof fetchAppData>[0], {
    organizationId: teacher.organizationId,
    membershipId: teacher.membershipId,
  });
}

async function stateOf(teacher: Teacher): Promise<SetupState> {
  const result = await teacher.repository.getState();
  if (!result.ok) throw new Error(`getState failed: ${result.message}`);
  return result.value;
}

async function storedDraftOf(teacher: Teacher): Promise<StoredSetupDraft> {
  const state = await stateOf(teacher);
  if (state.status !== "in-progress") throw new Error(`expected an in-progress draft, got ${state.status}`);
  return state.draft;
}

const OWNED_TABLES = [
  "courses",
  "class_sections",
  "bell_schedules",
  "schedule_blocks",
  "teacher_period_assignments",
  "teacher_schedule_preferences",
  "lessons",
  "lesson_class_sections",
  "setup_drafts",
  "setup_completions",
] as const;

/** Row counts per table for one membership - read as the database owner, so nothing RLS hides can be missed. */
async function ownedRowCounts(membershipId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of OWNED_TABLES) {
    const [{ count }] = await db.admin<{ count: number }>(
      `select count(*)::int as count from public.${table} where owner_membership_id = $1`,
      [membershipId],
    );
    counts[table] = count;
  }
  return counts;
}

function operationalRowTotal(counts: Record<string, number>): number {
  return OWNED_TABLES.filter((table) => !table.startsWith("setup_")).reduce((sum, table) => sum + counts[table], 0);
}

/** A complete "build my own schedule" draft: one new course, two sections, three periods, a first lesson. */
function ownScheduleDraft(): SetupDraft {
  const courseId = generateId("course");
  const firstSectionId = generateId("section");
  const secondSectionId = generateId("section");
  return {
    ...createEmptySetupDraft(),
    step: "review",
    courses: [{ id: courseId, name: "Geometry" }],
    classSections: [
      { id: firstSectionId, courseId, name: "Geometry - 1st Hour", room: "214" },
      { id: secondSectionId, courseId, name: "Geometry - 2nd Hour" },
    ],
    schedule: {
      mode: "own",
      id: generateId("schedule"),
      name: "My Schedule",
      timeZone: "America/Detroit",
      // Deliberately out of chronological order - positions must come from times.
      blocks: [
        { id: generateId("block"), label: "2nd Hour", kind: "instructional", startTime: "09:00", endTime: "09:50", classSectionId: secondSectionId },
        { id: generateId("block"), label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: firstSectionId },
        { id: generateId("block"), label: "Lunch", kind: "lunch", startTime: "11:00", endTime: "11:30", classSectionId: null },
      ],
    },
    lunchWave: "B",
    firstLesson: {
      id: generateId("lesson"),
      date: LESSON_DATE,
      classSectionId: firstSectionId,
      learningTarget: "I can find the midpoint of a segment.",
      agendaItems: [{ id: generateId("agenda"), title: "Warm-up", isCompleted: false, sortOrder: 0 }],
      resources: [],
      announcements: [],
      warmup: "Plot (2, 3) and (6, 7).",
    },
  };
}

/** A complete "use my school's schedule" draft against `base`'s shared schedule, using an existing catalog course. */
function sharedScheduleDraft(base: AppData, catalogCourseId: string): SetupDraft {
  const schedule = base.schedules.find((candidate) => candidate.id === SHARED_SCHEDULE_ID);
  if (!schedule) throw new Error("shared schedule fixture is not visible to this teacher");
  const sectionId = generateId("section");
  return {
    ...createEmptySetupDraft(),
    step: "review",
    classSections: [{ id: sectionId, courseId: catalogCourseId, name: "Algebra 1 - 1st Hour" }],
    schedule: {
      mode: "shared",
      scheduleId: schedule.id,
      expectedBlocks: snapshotSharedBlocks(schedule),
      assignments: [{ id: crypto.randomUUID(), blockId: schedule.blocks[0].id, classSectionId: sectionId }],
    },
    firstLesson: {
      id: generateId("lesson"),
      date: LESSON_DATE,
      classSectionId: sectionId,
      learningTarget: "I can solve one-step equations.",
      agendaItems: [],
      resources: [],
      announcements: [],
    },
  };
}

/** AppData with the two database-assigned lesson timestamps removed, for comparing against a projection. */
function withoutLessonTimestamps(data: AppData): AppData {
  return { ...data, lessons: data.lessons.map((lesson) => ({ ...lesson, createdAt: "", updatedAt: "" })) };
}

function byId<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Order-insensitive at the collection level (a table has no inherent row order); order-sensitive inside each item (block order is meaningful). */
function sameAppData(actual: AppData, expected: AppData): boolean {
  const normalize = (data: AppData) => ({
    ...withoutLessonTimestamps(data),
    courses: byId(data.courses),
    classSections: byId(data.classSections),
    schedules: byId(data.schedules),
    teacherPeriodAssignments: byId(data.teacherPeriodAssignments),
    lessons: byId(withoutLessonTimestamps(data).lessons),
  });
  return deepEqual(normalize(actual), normalize(expected));
}

/** Wraps a client so the next call to `rpcName` really executes, but its response never arrives. */
function loseNextResponse(client: RpcClient, rpcName: string): SetupRpcClient {
  let armed = true;
  return {
    async rpc(name, args) {
      const result = await client.rpc(name, args);
      if (armed && name === rpcName) {
        armed = false;
        return { data: null, error: { message: "TypeError: Failed to fetch" } };
      }
      return result;
    },
  };
}

async function main() {
  db = await createTestDatabase();

  console.log("1. Migrations and access model");
  {
    const files = listMigrationFiles();
    check("every migration applies to an empty database, the two new ones last", files.slice(-2).join() ===
      "20261010210000_onboarding_setup_stage_a_schema.sql,20261010210100_onboarding_setup_stage_b_rpcs.sql");

    const [privileges] = await db.admin<Record<string, boolean>>(`
      select
        has_table_privilege('authenticated', 'public.setup_drafts', 'select, insert, update, delete') as drafts_authenticated,
        has_table_privilege('anon', 'public.setup_drafts', 'select, insert, update, delete') as drafts_anon,
        has_table_privilege('authenticated', 'public.setup_completions', 'select, insert, update, delete') as completions_authenticated,
        has_table_privilege('anon', 'public.setup_completions', 'select, insert, update, delete') as completions_anon,
        has_function_privilege('authenticated', 'public.complete_setup(uuid, uuid, integer)', 'execute') as complete_authenticated,
        has_function_privilege('anon', 'public.complete_setup(uuid, uuid, integer)', 'execute') as complete_anon,
        has_function_privilege('anon', 'public.save_setup_draft(uuid, integer, jsonb)', 'execute') as save_anon,
        has_function_privilege('anon', 'public.get_setup_state(uuid)', 'execute') as state_anon,
        has_function_privilege('authenticated', 'public.setup_caller_membership(uuid)', 'execute') as helper_membership,
        has_function_privilege('authenticated', 'public.setup_ineligibility_reason(uuid)', 'execute') as helper_eligibility
    `);
    check("authenticated has no direct privilege on setup_drafts", privileges.drafts_authenticated === false);
    check("anon has no direct privilege on setup_drafts", privileges.drafts_anon === false);
    check("authenticated has no direct privilege on setup_completions", privileges.completions_authenticated === false);
    check("anon has no direct privilege on setup_completions", privileges.completions_anon === false);
    check("authenticated may execute complete_setup", privileges.complete_authenticated === true);
    check("anon may execute none of the three entry points", !privileges.complete_anon && !privileges.save_anon && !privileges.state_anon);
    check("the private helpers are not executable by authenticated", !privileges.helper_membership && !privileges.helper_eligibility);

    const [rls] = await db.admin<{ enabled: number }>(
      "select count(*)::int as enabled from pg_class where relname in ('setup_drafts', 'setup_completions') and relrowsecurity",
    );
    check("RLS is enabled on both new tables", rls.enabled === 2);
  }

  console.log("\n2. Entry: new accounts are eligible, existing and legacy accounts are not");
  const founder = await newFounder("founder");
  {
    const fresh = await stateOf(founder);
    check("a brand-new founder is not-started and eligible", fresh.status === "not-started" && fresh.eligible && fresh.reason === null);
    check("...and is routed to guided setup", deriveSetupEntry({ kind: "cloud-ready", organizationId: founder.organizationId, membershipId: founder.membershipId, migratedAt: null }, fresh) === "guided-setup");

    const legacy = await teacherFor(FIXTURE_LEGACY_USER_ID, FIXTURE_LEGACY_ORGANIZATION_ID);
    const legacyState = await stateOf(legacy);
    check("a migrated legacy account is ineligible (legacy-account)", legacyState.status === "not-started" && !legacyState.eligible && legacyState.reason === "legacy-account");
    check("...and stays in the existing app", deriveSetupEntry({ kind: "cloud-ready", organizationId: legacy.organizationId, membershipId: legacy.membershipId, migratedAt: "2026-09-01T00:00:00.000Z" }, legacyState) === "existing-app");
    const legacyCreate = await legacy.repository.saveDraft(null, createEmptySetupDraft());
    check("a legacy account cannot create a draft", legacyCreate.ok && legacyCreate.value.status === "ineligible");

    await db.admin("update public.organization_memberships set local_data_migrated_at = null where id = $1", [FIXTURE_LEGACY_MEMBERSHIP_ID]);
    const pendingState = await stateOf(legacy);
    check("a legacy account with migration pending is ineligible (migration-pending)", pendingState.status === "not-started" && pendingState.reason === "migration-pending");
    await db.admin("update public.organization_memberships set local_data_migrated_at = now() where id = $1", [FIXTURE_LEGACY_MEMBERSHIP_ID]);

    // An existing cloud account that already has a class.
    await db.admin(
      `insert into public.courses (id, organization_id, owner_type, owner_membership_id, name) values ('course-existing', $1, 'teacher', $2, 'Existing Course')`,
      [FIXTURE_CLOUD_ORGANIZATION_ID, FIXTURE_CLOUD_MEMBERSHIP_ID],
    );
    await db.admin(
      `insert into public.class_sections (id, organization_id, owner_membership_id, course_id, name) values ('section-existing', $1, $2, 'course-existing', 'Existing Section')`,
      [FIXTURE_CLOUD_ORGANIZATION_ID, FIXTURE_CLOUD_MEMBERSHIP_ID],
    );
    const existing = await teacherFor(FIXTURE_CLOUD_USER_ID, FIXTURE_CLOUD_ORGANIZATION_ID);
    const before = await loadAppData(existing);
    const existingState = await stateOf(existing);
    check("an existing cloud account with classes is ineligible (existing-setup)", existingState.status === "not-started" && !existingState.eligible && existingState.reason === "existing-setup");
    const existingCreate = await existing.repository.saveDraft(null, createEmptySetupDraft());
    check("...cannot create a draft", existingCreate.ok && existingCreate.value.status === "ineligible");
    check("...has no row in either setup table", (await ownedRowCounts(existing.membershipId)).setup_drafts === 0);
    check("...and loads exactly the same AppData as before", deepEqual(await loadAppData(existing), before));
  }

  console.log("\n3. Draft save, reload, resume");
  let founderDraft = ownScheduleDraft();
  {
    const session = new SetupDraftSession(founder.repository, null, createEmptySetupDraft());
    check("nothing is stored before the first edit", (await stateOf(founder)).status === "not-started");
    session.update({ ...createEmptySetupDraft(), courses: founderDraft.courses });
    session.update(founderDraft);
    await session.flush();
    check("two rapid edits end saved", session.getSnapshot().status.kind === "saved" && !session.getSnapshot().dirty);

    const stored = await storedDraftOf(founder);
    check("the stored draft is the latest edit, byte for byte", deepEqual(stored.payload, founderDraft));
    check("revision advanced once per accepted save", stored.revision === 2);

    // A fresh session, as after a reload or on another device.
    const resumed = new SetupDraftSession(founder.repository, stored, createEmptySetupDraft());
    check("a resumed session starts from the stored draft", deepEqual(resumed.getSnapshot().draft, founderDraft));
    resumed.update({ ...founderDraft, lunchWave: "A" });
    await resumed.flush();
    founderDraft = { ...founderDraft, lunchWave: "A" };
    const afterResume = await storedDraftOf(founder);
    check("the resumed session saves on top of it", afterResume.revision === 3 && afterResume.payload.lunchWave === "A");
    check("the operation id is the same across every save", afterResume.operationId === stored.operationId);
    check("no operational row exists while the draft is only a draft", operationalRowTotal(await ownedRowCounts(founder.membershipId)) === 0);
  }

  console.log("\n4. A stale tab is detected, never applied");
  {
    const stored = await storedDraftOf(founder);
    const tabOne = new SetupDraftSession(founder.repository, stored, createEmptySetupDraft());
    const tabTwo = new SetupDraftSession(founder.repository, stored, createEmptySetupDraft());

    tabOne.update({ ...founderDraft, lunchWave: "C" });
    await tabOne.flush();
    tabTwo.update({ ...founderDraft, lunchWave: "none" });
    await tabTwo.flush();

    const status = tabTwo.getSnapshot().status;
    check("the second tab reports a stale-revision conflict", status.kind === "conflict" && status.reason === "stale-revision");
    check("...carrying what the first tab stored", status.kind === "conflict" && status.serverDraft?.payload.lunchWave === "C");
    check("...and its own edit is still held, unsaved", tabTwo.getSnapshot().dirty && tabTwo.getSnapshot().draft.lunchWave === "none");
    check("the stored draft is still the first tab's", (await storedDraftOf(founder)).payload.lunchWave === "C");

    const staleComplete = await founder.repository.completeSetup(stored.operationId, stored.revision);
    check("completing from the stale revision is refused as a conflict", staleComplete.ok && staleComplete.value.status === "conflict" && staleComplete.value.reason === "stale-revision");
    check("...and wrote nothing", operationalRowTotal(await ownedRowCounts(founder.membershipId)) === 0);

    await tabTwo.resolveConflict("use-server");
    check("choosing the stored version adopts it", tabTwo.getSnapshot().draft.lunchWave === "C" && !tabTwo.getSnapshot().dirty);
    founderDraft = { ...founderDraft, lunchWave: "C" };
  }

  console.log("\n5. Another membership cannot reach this draft or setup");
  const outsider = await newFounder("outsider");
  {
    const founderStored = await storedDraftOf(founder);
    const intruder = new SupabaseSetupRepository(outsider.client, founder.organizationId);

    const read = await intruder.getState();
    check("reading another organization's setup state is rejected", !read.ok && read.kind === "rejected");
    const write = await intruder.saveDraft(founderStored.revision, createEmptySetupDraft());
    check("saving into another organization is rejected", !write.ok && write.kind === "rejected");
    const complete = await intruder.completeSetup(founderStored.operationId, founderStored.revision);
    check("completing in another organization is rejected", !complete.ok && complete.kind === "rejected");

    const ownOrg = await outsider.repository.completeSetup(founderStored.operationId, founderStored.revision);
    check("another membership naming this operation id in its own organization finds no draft", ownOrg.ok && ownOrg.value.status === "conflict" && ownOrg.value.reason === "draft-missing");

    const colleague = await newJoiner("colleague", founder.organizationId);
    const colleagueState = await stateOf(colleague);
    check("a colleague in the SAME organization sees only their own (empty) state", colleagueState.status === "not-started");
    const colleagueComplete = await colleague.repository.completeSetup(founderStored.operationId, founderStored.revision);
    check("...and cannot complete this draft", colleagueComplete.ok && colleagueComplete.value.status === "conflict" && colleagueComplete.value.reason === "draft-missing");

    const anonymous = await new SupabaseSetupRepository(db.clientFor(null), founder.organizationId).getState();
    check("an unauthenticated caller is rejected", !anonymous.ok && anonymous.kind === "rejected");

    let directReadDenied = false;
    try {
      await db.asUser(founder.userId, "select * from public.setup_drafts");
    } catch {
      directReadDenied = true;
    }
    check("even the owner cannot read setup_drafts directly", directReadDenied);

    const after = await storedDraftOf(founder);
    check("the draft is untouched by all of the above", after.revision === founderStored.revision && deepEqual(after.payload, founderStored.payload));
    check("nothing was written for either other membership", operationalRowTotal(await ownedRowCounts(outsider.membershipId)) === 0 && operationalRowTotal(await ownedRowCounts(colleague.membershipId)) === 0);
  }

  console.log("\n6. A failure midway through completion rolls everything back");
  {
    // Another teacher already owns a lesson with the id this draft will use,
    // so the LAST connected write (lessons) fails after courses, sections,
    // schedule, blocks, and preferences have all been written.
    await db.admin(
      `insert into public.lessons (id, organization_id, owner_membership_id, course_id, lesson_date) values ($1, $2, $3, 'course-existing', '2026-10-01')`,
      [founderDraft.firstLesson!.id, FIXTURE_CLOUD_ORGANIZATION_ID, FIXTURE_CLOUD_MEMBERSHIP_ID],
    );
    const stored = await storedDraftOf(founder);
    const session = new SetupDraftSession(founder.repository, stored, createEmptySetupDraft());
    const status = await session.complete();
    check("the completion is reported as rejected, not as unknown", status.kind === "completion-rejected");
    check("...and it was the final lesson write that failed, not an earlier check", status.kind === "completion-rejected" && status.message.includes("lessons_pkey"));

    const counts = await ownedRowCounts(founder.membershipId);
    check("no course, section, schedule, block, preference, or lesson survived", operationalRowTotal(counts) === 0);
    check("no completion was recorded", counts.setup_completions === 0);
    const after = await storedDraftOf(founder);
    check("the draft is still there, at the same revision", after.revision === stored.revision && deepEqual(after.payload, stored.payload));
    check("setup is still in progress", (await stateOf(founder)).status === "in-progress");

    await db.admin("delete from public.lessons where id = $1", [founderDraft.firstLesson!.id]);
  }

  console.log("\n7. Completion commits everything, once");
  const founderOperationId = (await storedDraftOf(founder)).operationId;
  let founderRevision = 0;
  {
    const base = await loadAppData(founder);
    check("the draft passes the client validator", validateSetupDraft(founderDraft, base).length === 0);
    const projection = projectSetupDraftToAppData(founderDraft, base, "");

    const stored = await storedDraftOf(founder);
    founderRevision = stored.revision;
    const session = new SetupDraftSession(founder.repository, stored, createEmptySetupDraft());
    const status = await session.complete();
    check("completion succeeds", status.kind === "completed");
    check("...under the draft's own operation id", status.kind === "completed" && status.completion.operationId === founderOperationId);

    const counts = await ownedRowCounts(founder.membershipId);
    check("exactly the drafted rows exist", counts.courses === 1 && counts.class_sections === 2 && counts.bell_schedules === 1 && counts.schedule_blocks === 3 && counts.teacher_schedule_preferences === 1 && counts.lessons === 1 && counts.lesson_class_sections === 1);
    check("no teacher_period_assignments for a private schedule", counts.teacher_period_assignments === 0);
    check("the draft is gone and one completion is recorded", counts.setup_drafts === 0 && counts.setup_completions === 1);

    const loaded = await loadAppData(founder);
    check("an ordinary load() returns exactly what the preview projection showed", sameAppData(loaded, projection));
    const active = loaded.schedules.find((schedule) => schedule.id === loaded.teacherSchedulePreferences.activeBellScheduleId);
    check("the private schedule is active, teacher-owned, with blocks in chronological order", active?.ownerType === "teacher" && active.blocks.map((block) => block.label).join() === "1st Hour,2nd Hour,Lunch");
    check("the existing readiness logic now reports core setup complete", getOnboardingStatus(loaded).coreSetupComplete);

    const state = await stateOf(founder);
    check("setup state is completed", state.status === "completed");
    check("...so the account is no longer routed to guided setup", deriveSetupEntry({ kind: "cloud-ready", organizationId: founder.organizationId, membershipId: founder.membershipId, migratedAt: null }, state) === "existing-app");
  }

  console.log("\n8. Duplicate submissions return the existing result");
  {
    const before = await ownedRowCounts(founder.membershipId);
    const first = await stateOf(founder);
    const [again, andAgain] = await Promise.all([
      founder.repository.completeSetup(founderOperationId, founderRevision),
      founder.repository.completeSetup(founderOperationId, founderRevision),
    ]);
    check("a repeat is reported completed and replayed", again.ok && again.value.status === "completed" && again.value.replayed);
    check("...with the identical stored result", again.ok && again.value.status === "completed" && first.status === "completed" && deepEqual(again.value.completion, first.completion));
    check("a second repeat behaves the same", andAgain.ok && andAgain.value.status === "completed" && andAgain.value.replayed);
    check("no row was added by either", deepEqual(await ownedRowCounts(founder.membershipId), before));

    const staleSave = await founder.repository.saveDraft(founderRevision, founderDraft);
    check("a stale tab's autosave after completion is answered 'completed'", staleSave.ok && staleSave.value.status === "completed");
    const recreate = await founder.repository.saveDraft(null, createEmptySetupDraft());
    check("...and a draft cannot be re-created", recreate.ok && recreate.value.status === "completed");
    check("...so no draft reappears", (await ownedRowCounts(founder.membershipId)).setup_drafts === 0);

    const otherOperation = await founder.repository.completeSetup(crypto.randomUUID(), 1);
    check("a different operation for a completed membership is refused as already-completed", otherOperation.ok && otherOperation.value.status === "conflict" && otherOperation.value.reason === "already-completed");
  }

  console.log("\n9. Commit succeeds but the response is lost");
  {
    const teacher = await newFounder("lossy");
    const draft = ownScheduleDraft();

    // 9a. A lost SAVE response: the next save must not conflict with itself.
    const flakySave = new SupabaseSetupRepository(loseNextResponse(teacher.client, "save_setup_draft"), teacher.organizationId);
    const saving = new SetupDraftSession(flakySave, null, createEmptySetupDraft());
    saving.update(draft);
    await saving.flush();
    check("a save whose response is lost is shown as failed, with the edit kept", saving.getSnapshot().status.kind === "save-failed" && saving.getSnapshot().dirty);
    check("...although it was in fact stored", (await storedDraftOf(teacher)).revision === 1);
    await saving.retrySave();
    check("retrying recognizes its own write instead of reporting a conflict", saving.getSnapshot().status.kind === "saved" && !saving.getSnapshot().dirty);
    check("...and does not store it twice", (await storedDraftOf(teacher)).revision === 1);

    // 9b. A lost COMPLETION response.
    const stored = await storedDraftOf(teacher);
    const flakyComplete = new SupabaseSetupRepository(loseNextResponse(teacher.client, "complete_setup"), teacher.organizationId);
    const session = new SetupDraftSession(flakyComplete, stored, createEmptySetupDraft());
    const first = await session.complete();
    check("the teacher is told the outcome is unconfirmed - not that it failed", first.kind === "completion-unconfirmed");
    const committed = await ownedRowCounts(teacher.membershipId);
    check("...while the commit actually happened", committed.setup_completions === 1 && committed.class_sections === 2);

    const second = await session.complete();
    check("retrying returns the completed result", second.kind === "completed" && second.completion.operationId === stored.operationId);
    check("...and created no duplicates", deepEqual(await ownedRowCounts(teacher.membershipId), committed));

    // 9c. The same loss, but the tab is reloaded instead of retried.
    const reloaded = await stateOf(teacher);
    check("after a reload the state is simply 'completed'", reloaded.status === "completed" && reloaded.completion.operationId === stored.operationId);
  }

  console.log("\n10. A shared schedule is used, never written");
  // The school's own data - created as the database owner, standing in for an admin.
  const school = await newFounder("school-admin");
  await db.admin(
    `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source)
     values ($1, $2, 'organization', null, 'Regular Day', true, 'built-in')`,
    [SHARED_SCHEDULE_ID, school.organizationId],
  );
  await db.admin(
    `insert into public.schedule_blocks (id, bell_schedule_id, organization_id, owner_type, owner_membership_id, position, label, kind, start_time, end_time)
     values
       ($1 || ':p1', $1, $2, 'organization', null, 0, '1st Hour', 'instructional', '08:00', '08:50'),
       ($1 || ':p2', $1, $2, 'organization', null, 1, '2nd Hour', 'instructional', '08:55', '09:45')`,
    [SHARED_SCHEDULE_ID, school.organizationId],
  );
  await db.admin(
    `insert into public.courses (id, organization_id, owner_type, owner_membership_id, name) values ('course-catalog-algebra', $1, 'organization', null, 'Algebra 1')`,
    [school.organizationId],
  );
  const sharedRowsSql = `
    select 'schedule' as kind, to_jsonb(b.*) as row from public.bell_schedules b where b.id = '${SHARED_SCHEDULE_ID}'
    union all
    select 'block', to_jsonb(sb.*) from public.schedule_blocks sb where sb.bell_schedule_id = '${SHARED_SCHEDULE_ID}'
    order by 1, 2`;
  {
    const teacher = await newJoiner("joiner", school.organizationId);
    const base = await loadAppData(teacher);
    const draft = sharedScheduleDraft(base, "course-catalog-algebra");
    check("the draft passes the client validator", validateSetupDraft(draft, base).length === 0);
    const sharedRowsBefore = await db.admin(sharedRowsSql);

    const session = new SetupDraftSession(teacher.repository, null, createEmptySetupDraft());
    session.update(draft);
    const status = await session.complete();
    check("completion succeeds", status.kind === "completed" && status.completion.scheduleMode === "shared");

    const counts = await ownedRowCounts(teacher.membershipId);
    check("the teacher owns one assignment and no schedule rows", counts.teacher_period_assignments === 1 && counts.bell_schedules === 0 && counts.schedule_blocks === 0);
    check("no course was created for a catalog course", counts.courses === 0 && counts.class_sections === 1);
    check("the shared schedule's rows are byte-identical (updated_at included)", deepEqual(await db.admin(sharedRowsSql), sharedRowsBefore));
    check("the organization still has exactly one schedule and one catalog course", (await db.admin(
      "select 1 from public.bell_schedules where organization_id = $1 union all select 1 from public.courses where organization_id = $1", [school.organizationId])).length === 2);

    const loaded = await loadAppData(teacher);
    check("an ordinary load() returns exactly what the preview projection showed", sameAppData(loaded, projectSetupDraftToAppData(draft, base, "")));
    check("the shared schedule is active and shows this teacher's class in 1st Hour", loaded.teacherSchedulePreferences.activeBellScheduleId === SHARED_SCHEDULE_ID &&
      loaded.schedules.find((schedule) => schedule.id === SHARED_SCHEDULE_ID)?.blocks[0].classSectionId === draft.classSections[0].id);

    const other = await loadAppData(await newJoiner("joiner-two", school.organizationId));
    check("another teacher in the school sees the same schedule with no class assigned", other.schedules.find((schedule) => schedule.id === SHARED_SCHEDULE_ID)?.blocks[0].classSectionId === null);
  }

  console.log("\n11. A shared schedule that changed after it was chosen");
  {
    const teacher = await newJoiner("late-joiner", school.organizationId);
    const base = await loadAppData(teacher);
    const draft = sharedScheduleDraft(base, "course-catalog-algebra");
    const session = new SetupDraftSession(teacher.repository, null, createEmptySetupDraft());
    session.update(draft);
    await session.flush();

    // The school moves 1st Hour while this teacher's draft is open.
    await db.admin("update public.schedule_blocks set start_time = '08:05' where id = $1", [`${SHARED_SCHEDULE_ID}:p1`]);

    const status = await session.complete();
    check("completion is refused as shared-schedule-changed", status.kind === "conflict" && status.reason === "shared-schedule-changed");
    const counts = await ownedRowCounts(teacher.membershipId);
    check("nothing was written", operationalRowTotal(counts) === 0 && counts.setup_completions === 0);
    check("the draft is kept", counts.setup_drafts === 1);

    const refreshed = await loadAppData(teacher);
    check("the client validator reports the change against fresh data", validateSetupDraft(draft, refreshed).some((issue) => issue.message.includes("schedule has changed")));

    // The teacher reviews the new periods; the draft is rebuilt against them.
    const refreshedSchedule = refreshed.schedules.find((schedule) => schedule.id === SHARED_SCHEDULE_ID)!;
    const reviewed: SetupDraft =
      draft.schedule?.mode === "shared"
        ? { ...draft, schedule: { ...draft.schedule, expectedBlocks: snapshotSharedBlocks(refreshedSchedule) } }
        : draft;
    session.update(reviewed);
    await session.resolveConflict("keep-mine");
    const retried = await session.complete();
    check("after review, the same operation completes", retried.kind === "completed");
    check("...with exactly one assignment", (await ownedRowCounts(teacher.membershipId)).teacher_period_assignments === 1);
  }

  console.log("\n12. Identity and ownership come from the server, not the payload");
  {
    const teacher = await newJoiner("spoofer", school.organizationId);
    const draft = ownScheduleDraft();
    const spoofed = {
      ...draft,
      organization_id: outsider.organizationId,
      owner_membership_id: outsider.membershipId,
      courses: draft.courses.map((course) => ({ ...course, ownerType: "organization", owner_type: "organization", organization_id: outsider.organizationId })),
    } as SetupDraft;
    const session = new SetupDraftSession(teacher.repository, null, createEmptySetupDraft());
    session.update(spoofed);
    const status = await session.complete();
    check("completion succeeds", status.kind === "completed");
    const [course] = await db.admin<{ organization_id: string; owner_type: string; owner_membership_id: string }>(
      "select organization_id, owner_type, owner_membership_id from public.courses where id = $1", [draft.courses[0].id]);
    check("the course is teacher-owned by the caller, in the caller's organization", course.owner_type === "teacher" && course.owner_membership_id === teacher.membershipId && course.organization_id === teacher.organizationId);
    check("nothing was written into the organization named in the payload", operationalRowTotal(await ownedRowCounts(outsider.membershipId)) === 0);

    // A class pointing at another teacher's private course in the same school.
    const thief = await newJoiner("course-thief", school.organizationId);
    const stolen = ownScheduleDraft();
    const stolenDraft: SetupDraft = {
      ...stolen,
      courses: [],
      classSections: stolen.classSections.map((section) => ({ ...section, courseId: draft.courses[0].id })),
    };
    const thiefSession = new SetupDraftSession(thief.repository, null, createEmptySetupDraft());
    thiefSession.update(stolenDraft);
    const thiefStatus = await thiefSession.complete();
    check("a class on another teacher's private course is rejected", thiefStatus.kind === "completion-rejected");
    check("...and wrote nothing", operationalRowTotal(await ownedRowCounts(thief.membershipId)) === 0);
  }

  console.log("\n13. The client validator and the database agree on what may be completed");
  {
    // Built per case from a FRESH draft: ids such as courses.id are global primary
    // keys, so two accounts can never commit the same draft.
    const buildCases = (valid: SetupDraft) => {
      const ownSchedule = valid.schedule as Extract<SetupDraft["schedule"], { mode: "own" }>;
      const lesson = valid.firstLesson!;
      const blankLesson = { ...lesson, learningTarget: "", agendaItems: [], resources: [], announcements: [] };

      const cases: Array<{ label: string; draft: SetupDraft; completable: boolean; message?: string }> = [
        { label: "no classes", draft: { ...valid, classSections: [] }, completable: false },
        { label: "no schedule", draft: { ...valid, schedule: null }, completable: false },
        { label: "overlapping periods", draft: { ...valid, schedule: { ...ownSchedule, blocks: ownSchedule.blocks.map((block) => ({ ...block, startTime: "08:00", endTime: "09:30" })) } }, completable: false },
        { label: "no class in any period", draft: { ...valid, schedule: { ...ownSchedule, blocks: ownSchedule.blocks.map((block) => ({ ...block, classSectionId: null })) } }, completable: false },
        { label: "no first lesson", draft: { ...valid, firstLesson: null }, completable: false, message: "Plan a first lesson before finishing setup." },
        { label: "a first lesson for an unknown class", draft: { ...valid, firstLesson: { ...lesson, classSectionId: "section-nope" } }, completable: false },
        { label: "an empty first lesson", draft: { ...valid, firstLesson: blankLesson }, completable: false, message: "Add a learning target or an agenda item to your first lesson." },
        { label: "a first lesson whose learning target is only whitespace", draft: { ...valid, firstLesson: { ...blankLesson, learningTarget: " \t\n " } }, completable: false, message: "Add a learning target or an agenda item to your first lesson." },
        { label: "a first lesson with only an agenda item", draft: { ...valid, firstLesson: { ...blankLesson, agendaItems: lesson.agendaItems } }, completable: true },
        { label: "a first lesson with only a learning target", draft: { ...valid, firstLesson: { ...blankLesson, learningTarget: "I can." } }, completable: true },
        { label: "a first lesson with only an announcement", draft: { ...valid, firstLesson: { ...blankLesson, announcements: [{ id: generateId("announcement"), text: "Welcome!" }] } }, completable: true },
      ];
      return cases;
    };
    /** The database message -> the client validator's message for the same problem. */
    const CLIENT_WORDING: Record<string, string> = {
      "Plan a first lesson before finishing setup.": "Plan a first lesson for one of your classes.",
      "Add a learning target or an agenda item to your first lesson.": "Add a learning target or an agenda item to your first lesson.",
    };

    const caseCount = buildCases(ownScheduleDraft()).length;
    for (let index = 0; index < caseCount; index += 1) {
      const testCase = buildCases(ownScheduleDraft())[index];
      // A fresh account per case: a completion can only happen once.
      const teacher = await newFounder(`parity-${index}`);
      const clientIssues = validateSetupDraft(testCase.draft, await loadAppData(teacher));
      const clientAccepts = clientIssues.length === 0;
      const session = new SetupDraftSession(teacher.repository, null, createEmptySetupDraft());
      session.update(testCase.draft);
      const status = await session.complete();
      const databaseAccepts = status.kind === "completed";
      check(`${testCase.label}: client ${testCase.completable ? "accepts" : "refuses"}, database ${testCase.completable ? "accepts" : "refuses"}`,
        clientAccepts === testCase.completable && databaseAccepts === testCase.completable);
      if (!testCase.completable) {
        check("  ...refused as a rejection that wrote nothing", status.kind === "completion-rejected" && operationalRowTotal(await ownedRowCounts(teacher.membershipId)) === 0);
      }
      if (testCase.message) {
        check("  ...with the wording the client validator shows for the same problem", status.kind === "completion-rejected" && status.message === testCase.message && clientIssues.some((issue) => issue.message === CLIENT_WORDING[testCase.message ?? ""]));
      }
    }
  }

  console.log("\n14. Weekday overrides on a shared schedule are part of the change check");
  {
    const secondHour = scheduleBlockCloudId(SHARED_SCHEDULE_ID, "p2");
    const overrideId = scheduleBlockOverrideCloudId(secondHour, "ov-wed");
    const teacher = await newJoiner("override-watcher", school.organizationId);
    const session = new SetupDraftSession(teacher.repository, null, createEmptySetupDraft());
    let draft = sharedScheduleDraft(await loadAppData(teacher), "course-catalog-algebra");
    session.update(draft);
    await session.flush();

    /** What the teaching-day step does after a change: re-read the schedule, keep the teacher's own choices. */
    const review = async () => {
      const refreshed = await loadAppData(teacher);
      const schedule = refreshed.schedules.find((candidate) => candidate.id === SHARED_SCHEDULE_ID)!;
      const stale = draft.schedule?.mode === "shared" && hasSharedScheduleChanged(draft.schedule, refreshed.schedules);
      if (draft.schedule?.mode === "shared") {
        draft = { ...draft, schedule: { ...draft.schedule, expectedBlocks: snapshotSharedBlocks(schedule) } };
      }
      session.update(draft);
      await session.resolveConflict("keep-mine");
      return stale;
    };
    const refusedUnchanged = async () => {
      const status = await session.complete();
      const counts = await ownedRowCounts(teacher.membershipId);
      return status.kind === "conflict" && status.reason === "shared-schedule-changed" && operationalRowTotal(counts) === 0 && counts.setup_drafts === 1;
    };

    // The school adds a Wednesday-only time for 2nd Hour. No base period changes.
    await db.admin(
      `insert into public.schedule_block_overrides (id, schedule_block_id, organization_id, owner_type, owner_membership_id, weekday, start_time, end_time)
       values ($1, $2, $3, 'organization', null, 'wednesday', '09:10', '10:00')`,
      [overrideId, secondHour, school.organizationId],
    );
    check("an ADDED weekday override refuses completion and writes nothing", await refusedUnchanged());
    check("...and the client check sees it too, against fresh data", await review());

    await db.admin("update public.schedule_block_overrides set start_time = '09:15' where id = $1", [overrideId]);
    check("a CHANGED override time refuses completion", await refusedUnchanged());
    check("...and the client check sees it", await review());

    await db.admin("update public.schedule_block_overrides set label = 'Advisory' where id = $1", [overrideId]);
    check("a CHANGED override label refuses completion", await refusedUnchanged());
    check("...and the client check sees it", await review());

    await db.admin("delete from public.schedule_block_overrides where id = $1", [overrideId]);
    check("a REMOVED override refuses completion", await refusedUnchanged());
    check("...and the client check sees it", await review());

    // Two overrides, stored in an order that is not weekday order.
    await db.admin(
      `insert into public.schedule_block_overrides (id, schedule_block_id, organization_id, owner_type, owner_membership_id, weekday, label)
       values ($1, $3, $4, 'organization', null, 'wednesday', 'Advisory'), ($2, $3, $4, 'organization', null, 'friday', 'Assembly')`,
      [overrideId, scheduleBlockOverrideCloudId(secondHour, "ov-fri"), secondHour, school.organizationId],
    );
    check("two more overrides refuse completion", await refusedUnchanged());
    await review();
    const status = await session.complete();
    check("once the snapshot matches base periods AND overrides, the same operation completes", status.kind === "completed");
    check("an unchanged schedule with overrides is not reported as changed", draft.schedule?.mode === "shared" && !hasSharedScheduleChanged(draft.schedule, (await loadAppData(teacher)).schedules));
    await db.admin("delete from public.schedule_block_overrides where schedule_block_id = $1", [secondHour]);
  }

  console.log("\n15. Interrupted new accounts resume; established accounts are left alone");
  {
    // (a) Picked the school's schedule on the existing /setup/schedule screen, then stopped.
    // Written the way the ordinary app writes it: the teacher's own row, through RLS.
    const picker = await newJoiner("picked-a-schedule", school.organizationId);
    await db.asUser(
      picker.userId,
      `insert into public.teacher_schedule_preferences (owner_membership_id, organization_id, lunch_wave, active_bell_schedule_id) values ($1, $2, 'B', $3)`,
      [picker.membershipId, picker.organizationId, SHARED_SCHEDULE_ID],
    );
    const pickerState = await stateOf(picker);
    check("a new account that only chose a shared schedule is still eligible", pickerState.status === "not-started" && pickerState.eligible);
    check("...and its existing choice comes back as the seed", pickerState.status === "not-started" && deepEqual(pickerState.seed, { activeBellScheduleId: SHARED_SCHEDULE_ID, lunchWave: "B" }));
    check("...so it is routed to guided setup", deriveSetupEntry({ kind: "cloud-ready", organizationId: picker.organizationId, membershipId: picker.membershipId, migratedAt: null }, pickerState) === "guided-setup");

    const pickerBase = await loadAppData(picker);
    const seeded = pickerState.status === "not-started" ? createSetupDraftFromSeed(pickerState.seed, pickerBase.schedules) : createEmptySetupDraft();
    check("the starting draft already has that schedule selected, with nothing assigned yet", seeded.schedule?.mode === "shared" && seeded.schedule.scheduleId === SHARED_SCHEDULE_ID && seeded.schedule.assignments.length === 0 && seeded.lunchWave === "B");

    const finished = sharedScheduleDraft(pickerBase, "course-catalog-algebra");
    const pickerSession = new SetupDraftSession(picker.repository, null, seeded);
    pickerSession.update({ ...finished, lunchWave: seeded.lunchWave });
    check("it completes", (await pickerSession.complete()).kind === "completed");
    const pickerCounts = await ownedRowCounts(picker.membershipId);
    check("...updating its one preferences row rather than adding another", pickerCounts.teacher_schedule_preferences === 1);
    const pickerLoaded = await loadAppData(picker);
    check("...with the schedule and lunch wave it had chosen", deepEqual(pickerLoaded.teacherSchedulePreferences, { lunchWave: "B", activeBellScheduleId: SHARED_SCHEDULE_ID }));

    // (b) A brand-new account with nothing chosen: an empty seed.
    const untouched = await newJoiner("chose-nothing", school.organizationId);
    const untouchedState = await stateOf(untouched);
    check("a brand-new account has an empty seed", untouchedState.status === "not-started" && deepEqual(untouchedState.seed, { activeBellScheduleId: null, lunchWave: "none" }));
    check("...which produces an empty starting draft", untouchedState.status === "not-started" && deepEqual(createSetupDraftFromSeed(untouchedState.seed, pickerBase.schedules), createEmptySetupDraft()));

    // (c) A draft is in progress, and then the account is set up in the existing app. Existing setup wins:
    // the draft is no longer offered for resuming. (Section 18 covers what else is refused.)
    const midway = await newFounder("midway");
    const midwaySession = new SetupDraftSession(midway.repository, null, createEmptySetupDraft());
    midwaySession.update(ownScheduleDraft());
    await midwaySession.flush();
    const midwayAuthority = { kind: "cloud-ready" as const, organizationId: midway.organizationId, membershipId: midway.membershipId, migratedAt: null };
    const midwayBefore = await stateOf(midway);
    check("a draft in progress resumes while the account is still eligible", midwayBefore.status === "in-progress" && deriveSetupEntry(midwayAuthority, midwayBefore) === "guided-setup");
    await midway.client.rpc("import_bell_schedule", {
      p_organization_id: midway.organizationId, p_id: generateId("schedule"), p_name: "Built elsewhere",
      p_blocks: [{ id: "b1", label: "1st", kind: "instructional", start_time: "08:00", end_time: "08:50" }], p_time_zone: "America/Detroit",
    });
    const midwayState = await stateOf(midway);
    check("once the account has built its own schedule, the draft is no longer reported", midwayState.status === "not-started" && !midwayState.eligible && midwayState.reason === "existing-setup");
    check("...and entry goes to the existing app, not back into guided setup", deriveSetupEntry(midwayAuthority, midwayState) === "existing-app");

    // (d) Established: built its own schedule in the existing app, no draft.
    const builder = await newFounder("built-own-schedule");
    const ownScheduleId = generateId("schedule");
    await builder.client.rpc("import_bell_schedule", {
      p_organization_id: builder.organizationId, p_id: ownScheduleId, p_name: "My own",
      p_blocks: [{ id: "b1", label: "1st", kind: "instructional", start_time: "08:00", end_time: "08:50" }], p_time_zone: "America/Detroit",
    });
    await db.asUser(
      builder.userId,
      `insert into public.teacher_schedule_preferences (owner_membership_id, organization_id, lunch_wave, active_bell_schedule_id) values ($1, $2, 'none', $3)`,
      [builder.membershipId, builder.organizationId, ownScheduleId],
    );
    const builderBefore = await loadAppData(builder);
    const builderState = await stateOf(builder);
    check("an account that built its own schedule is established (existing-setup)", builderState.status === "not-started" && !builderState.eligible && builderState.reason === "existing-setup");
    check("...stays in the existing app", deriveSetupEntry({ kind: "cloud-ready", organizationId: builder.organizationId, membershipId: builder.membershipId, migratedAt: null }, builderState) === "existing-app");
    const builderCreate = await builder.repository.saveDraft(null, createEmptySetupDraft());
    check("...cannot create a draft", builderCreate.ok && builderCreate.value.status === "ineligible");
    check("...and its data is exactly as it was", deepEqual(await loadAppData(builder), builderBefore));

    // (e) Legacy: unchanged from section 2, re-checked after everything above.
    const legacyState = await stateOf(await teacherFor(FIXTURE_LEGACY_USER_ID, FIXTURE_LEGACY_ORGANIZATION_ID));
    check("a legacy account is still ineligible", legacyState.status === "not-started" && !legacyState.eligible && legacyState.reason === "legacy-account");
  }

  console.log("\n16. Existing entry points are unaffected");
  {
    const legacyCounts = await ownedRowCounts(FIXTURE_LEGACY_MEMBERSHIP_ID);
    check("the legacy fixture membership has no setup rows and no new data", legacyCounts.setup_drafts === 0 && legacyCounts.setup_completions === 0 && operationalRowTotal(legacyCounts) === 0);
    const again = await founder.client.rpc("bootstrap_organization", { organization_name: "Second School" });
    check("bootstrap_organization still refuses a second organization", again.error?.code === "42501");
    const imported = await founder.client.rpc("import_bell_schedule", {
      p_organization_id: founder.organizationId,
      p_id: generateId("schedule"),
      p_name: "Imported",
      p_blocks: [{ id: "b1", label: "1st", kind: "instructional", start_time: "08:00", end_time: "08:50" }],
      p_time_zone: "America/Detroit",
    });
    check("import_bell_schedule still works for an account that completed guided setup", imported.error === null);
  }

  console.log("\n17. Eligibility is re-checked when setup is completed");
  {
    // A draft is started, and then the teacher sets the account up in the ordinary screens instead.
    const teacher = await newFounder("late-ineligible");
    const draft = ownScheduleDraft();
    const seeded = await teacher.repository.saveDraft(null, draft);
    if (!seeded.ok || seeded.value.status !== "saved") throw new Error("could not seed the draft");

    const courseId = generateId("course");
    const sectionId = generateId("section");
    const scheduleId = generateId("schedule");
    await db.asUser(teacher.userId, `insert into public.courses (id, organization_id, owner_type, owner_membership_id, name) values ($1, $2, 'teacher', $3, 'Algebra')`, [courseId, teacher.organizationId, teacher.membershipId]);
    await db.asUser(teacher.userId, `insert into public.class_sections (id, organization_id, owner_membership_id, course_id, name) values ($1, $2, $3, $4, 'Algebra - 2nd Hour')`, [sectionId, teacher.organizationId, teacher.membershipId, courseId]);
    await db.asUser(teacher.userId, `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source) values ($1, $2, 'teacher', $3, 'My ordinary schedule', false, 'custom')`, [scheduleId, teacher.organizationId, teacher.membershipId]);
    await db.asUser(teacher.userId, `insert into public.teacher_schedule_preferences (owner_membership_id, organization_id, lunch_wave, active_bell_schedule_id) values ($1, $2, 'A', $3)`, [teacher.membershipId, teacher.organizationId, scheduleId]);

    const before = await ownedRowCounts(teacher.membershipId);
    const outcome = await teacher.repository.completeSetup(seeded.value.operationId, seeded.value.revision);
    check(
      "completion is returned as a conflict: no-longer-eligible / existing-setup",
      outcome.ok && outcome.value.status === "conflict" && outcome.value.reason === "no-longer-eligible" && outcome.value.ineligibility === "existing-setup",
    );
    const after = await ownedRowCounts(teacher.membershipId);
    check("no record of any kind was created", JSON.stringify(after) === JSON.stringify(before) && after.setup_completions === 0);
    const [prefs] = await db.admin<{ lunch_wave: string; active_bell_schedule_id: string }>("select lunch_wave, active_bell_schedule_id from public.teacher_schedule_preferences where owner_membership_id = $1", [teacher.membershipId]);
    check("the schedule and lunch wave chosen in the ordinary screens are not replaced", prefs.active_bell_schedule_id === scheduleId && prefs.lunch_wave === "A");
    check("the draft is kept, not consumed", after.setup_drafts === 1);
    const again = await teacher.repository.completeSetup(seeded.value.operationId, seeded.value.revision);
    check("asking again gives the same answer and still writes nothing", again.ok && again.value.status === "conflict" && again.value.reason === "no-longer-eligible" && JSON.stringify(await ownedRowCounts(teacher.membershipId)) === JSON.stringify(before));

    // The session a screen would use ends up "ineligible", not offering a side to choose.
    const stored: StoredSetupDraft = { operationId: seeded.value.operationId, revision: seeded.value.revision, updatedAt: seeded.value.updatedAt, payload: draft };
    const session = new SetupDraftSession(teacher.repository, stored, createEmptySetupDraft());
    const status = await session.complete();
    check("SetupDraftSession reports it as ineligible", status.kind === "ineligible" && status.reason === "existing-setup");

    // An account whose guided setup DID commit owns classes too. Its retry must still be answered from the ledger.
    const done = await newFounder("replay-after-recheck");
    const doneSeed = await done.repository.saveDraft(null, ownScheduleDraft());
    if (!doneSeed.ok || doneSeed.value.status !== "saved") throw new Error("could not seed the draft");
    const firstTime = await done.repository.completeSetup(doneSeed.value.operationId, doneSeed.value.revision);
    check("an eligible account still completes", firstTime.ok && firstTime.value.status === "completed" && !firstTime.value.replayed);
    const committed = await ownedRowCounts(done.membershipId);
    const retry = await done.repository.completeSetup(doneSeed.value.operationId, doneSeed.value.revision);
    check(
      "a retry of that completed operation is replayed, not refused as ineligible",
      retry.ok && retry.value.status === "completed" && retry.value.replayed && firstTime.ok && firstTime.value.status === "completed" &&
        JSON.stringify(retry.value.completion) === JSON.stringify(firstTime.value.completion),
    );
    check("...and writes nothing", JSON.stringify(await ownedRowCounts(done.membershipId)) === JSON.stringify(committed));
    const otherOperation = await done.repository.completeSetup(crypto.randomUUID(), 1);
    check("a different operation for that account is still 'already-completed'", otherOperation.ok && otherOperation.value.status === "conflict" && otherOperation.value.reason === "already-completed");
  }

  console.log("\n18. Setup done in the ordinary screens outranks an unfinished draft");
  {
    const teacher = await newFounder("draft-then-ordinary");
    const authority = { kind: "cloud-ready" as const, organizationId: teacher.organizationId, membershipId: teacher.membershipId, migratedAt: null };
    const draft = ownScheduleDraft();
    const seeded = await teacher.repository.saveDraft(null, draft);
    if (!seeded.ok || seeded.value.status !== "saved") throw new Error("could not seed the draft");
    const draftRow = async () =>
      (await db.admin<{ revision: number; payload: SetupDraft }>("select revision, payload from public.setup_drafts where owner_membership_id = $1", [teacher.membershipId]))[0];

    // The teacher sets the account up in the ordinary screens instead: a course and a class, through RLS.
    const courseId = generateId("course");
    await db.asUser(teacher.userId, `insert into public.courses (id, organization_id, owner_type, owner_membership_id, name) values ($1, $2, 'teacher', $3, 'Algebra')`, [courseId, teacher.organizationId, teacher.membershipId]);
    await db.asUser(teacher.userId, `insert into public.class_sections (id, organization_id, owner_membership_id, course_id, name) values ($1, $2, $3, $4, 'Algebra - 2nd Hour')`, [generateId("section"), teacher.organizationId, teacher.membershipId, courseId]);
    const before = await ownedRowCounts(teacher.membershipId);
    const storedBefore = await draftRow();

    const state = await stateOf(teacher);
    check("get_setup_state no longer reports the draft: not-started, not eligible, existing-setup", state.status === "not-started" && !state.eligible && state.reason === "existing-setup");
    check("deriveSetupEntry sends the account to the existing app", deriveSetupEntry(authority, state) === "existing-app");

    const revise = await teacher.repository.saveDraft(seeded.value.revision, { ...draft, step: "first-lesson" });
    check("revising the draft is refused as ineligible", revise.ok && revise.value.status === "ineligible" && revise.value.reason === "existing-setup");
    const recreate = await teacher.repository.saveDraft(null, createEmptySetupDraft());
    check("creating a draft is refused as ineligible (not reported as draft-exists)", recreate.ok && recreate.value.status === "ineligible");
    const complete = await teacher.repository.completeSetup(seeded.value.operationId, seeded.value.revision);
    check("completing it is refused as no-longer-eligible", complete.ok && complete.value.status === "conflict" && complete.value.reason === "no-longer-eligible");

    const storedAfter = await draftRow();
    check("the abandoned draft is retained, exactly as it was", storedAfter?.revision === storedBefore.revision && deepEqual(storedAfter.payload, storedBefore.payload));
    check("none of those attempts wrote anything", JSON.stringify(await ownedRowCounts(teacher.membershipId)) === JSON.stringify(before));
    const stateAgain = await stateOf(teacher);
    check("...and none of them made the draft resumable again", stateAgain.status === "not-started" && !stateAgain.eligible && deriveSetupEntry(authority, stateAgain) === "existing-app");

    // A tab that still has the draft open: its next autosave stops, it does not reopen the flow.
    const openTab = new SetupDraftSession(teacher.repository, { operationId: seeded.value.operationId, revision: seeded.value.revision, updatedAt: seeded.value.updatedAt, payload: draft }, createEmptySetupDraft());
    openTab.update({ ...draft, step: "review" });
    await openTab.flush();
    const tabStatus = openTab.getSnapshot().status;
    check("a tab still editing that draft is told it is ineligible", tabStatus.kind === "ineligible" && tabStatus.reason === "existing-setup");
    check("...and its edit was not stored", (await draftRow())?.revision === storedBefore.revision);
  }

  console.log("\n19. Schedule preferences changed outside guided setup are not replaced");
  {
    const ALT_SCHEDULE_ID = "schedule-shared-alternate";
    await db.admin(
      `insert into public.bell_schedules (id, organization_id, owner_type, owner_membership_id, name, is_default, source)
       values ($1, $2, 'organization', null, 'Alternate Day', false, 'built-in')`,
      [ALT_SCHEDULE_ID, school.organizationId],
    );
    await db.admin(
      `insert into public.schedule_blocks (id, bell_schedule_id, organization_id, owner_type, owner_membership_id, position, label, kind, start_time, end_time)
       values ($1, $2, $3, 'organization', null, 0, '1st Hour', 'instructional', '08:30', '09:20')`,
      [scheduleBlockCloudId(ALT_SCHEDULE_ID, "p1"), ALT_SCHEDULE_ID, school.organizationId],
    );
    const preferencesOf = async (teacher: Teacher) =>
      (await db.admin<{ lunch_wave: string; active_bell_schedule_id: string | null }>("select lunch_wave, active_bell_schedule_id from public.teacher_schedule_preferences where owner_membership_id = $1", [teacher.membershipId]))[0] ?? null;
    const baselineOf = async (teacher: Teacher) =>
      (await db.admin<{ baseline_lunch_wave: string; baseline_active_bell_schedule_id: string | null }>("select baseline_lunch_wave, baseline_active_bell_schedule_id from public.setup_drafts where owner_membership_id = $1", [teacher.membershipId]))[0];
    /** An interrupted account: chose the school's schedule and lunch wave B in the ordinary screens, then started a draft that keeps both. */
    const interrupted = async (label: string) => {
      const teacher = await newJoiner(label, school.organizationId);
      await db.asUser(teacher.userId, `insert into public.teacher_schedule_preferences (owner_membership_id, organization_id, lunch_wave, active_bell_schedule_id) values ($1, $2, 'B', $3)`, [teacher.membershipId, teacher.organizationId, SHARED_SCHEDULE_ID]);
      const draft: SetupDraft = { ...sharedScheduleDraft(await loadAppData(teacher), "course-catalog-algebra"), lunchWave: "B" };
      const session = new SetupDraftSession(teacher.repository, null, createEmptySetupDraft());
      session.update(draft);
      await session.flush();
      return { teacher, draft, session };
    };

    // (a) Only the lunch wave changes after the draft was created.
    const lunch = await interrupted("lunch-wave-changed");
    check("the draft records the preferences in force when it was created", deepEqual(await baselineOf(lunch.teacher), { baseline_lunch_wave: "B", baseline_active_bell_schedule_id: SHARED_SCHEDULE_ID }));
    await db.asUser(lunch.teacher.userId, "update public.teacher_schedule_preferences set lunch_wave = 'A' where owner_membership_id = $1", [lunch.teacher.membershipId]);
    const lunchBefore = await ownedRowCounts(lunch.teacher.membershipId);
    const lunchStatus = await lunch.session.complete();
    check("a lunch-wave-only change refuses completion as preferences-changed", lunchStatus.kind === "conflict" && lunchStatus.reason === "preferences-changed");
    check("...reporting the preferences now in force", lunchStatus.kind === "conflict" && deepEqual(lunchStatus.preferences, { activeBellScheduleId: SHARED_SCHEDULE_ID, lunchWave: "A" }));
    check("...writing nothing", JSON.stringify(await ownedRowCounts(lunch.teacher.membershipId)) === JSON.stringify(lunchBefore) && lunchBefore.class_sections === 0);
    check("...and leaving the newer lunch wave in place", deepEqual(await preferencesOf(lunch.teacher), { lunch_wave: "A", active_bell_schedule_id: SHARED_SCHEDULE_ID }));

    // Saving the draft again must not move the baseline - otherwise any autosave would wave the change through.
    lunch.session.update({ ...lunch.draft, step: "first-lesson" });
    await lunch.session.resolveConflict("keep-mine");
    check("a draft save does not reset the baseline", deepEqual(await baselineOf(lunch.teacher), { baseline_lunch_wave: "B", baseline_active_bell_schedule_id: SHARED_SCHEDULE_ID }));
    const lunchAgain = await lunch.session.complete();
    check("...so completion is still refused after it", lunchAgain.kind === "conflict" && lunchAgain.reason === "preferences-changed" && (await ownedRowCounts(lunch.teacher.membershipId)).class_sections === 0);

    // The teacher's draft is brought into line with the newer choice; nothing newer is lost by completing it.
    lunch.session.update({ ...lunch.draft, lunchWave: "A" });
    await lunch.session.resolveConflict("keep-mine");
    const lunchDone = await lunch.session.complete();
    check("a draft that adopts the newer lunch wave completes", lunchDone.kind === "completed");
    check("...keeping that lunch wave", deepEqual(await preferencesOf(lunch.teacher), { lunch_wave: "A", active_bell_schedule_id: SHARED_SCHEDULE_ID }));

    // A retry of that committed operation is replayed even though preferences have moved on again.
    await db.asUser(lunch.teacher.userId, "update public.teacher_schedule_preferences set lunch_wave = 'C' where owner_membership_id = $1", [lunch.teacher.membershipId]);
    const committedCounts = await ownedRowCounts(lunch.teacher.membershipId);
    const operationId = lunchDone.kind === "completed" ? lunchDone.completion.operationId : "";
    const replay = await lunch.teacher.repository.completeSetup(operationId, 1);
    check("a retry of the committed operation is replayed, not refused", replay.ok && replay.value.status === "completed" && replay.value.replayed && lunchDone.kind === "completed" && deepEqual(replay.value.completion, lunchDone.completion));
    check("...writes nothing, and does not put the old lunch wave back", JSON.stringify(await ownedRowCounts(lunch.teacher.membershipId)) === JSON.stringify(committedCounts) && (await preferencesOf(lunch.teacher))?.lunch_wave === "C");

    // (b) Only the active schedule changes after the draft was created.
    const schedule = await interrupted("schedule-changed");
    await db.asUser(schedule.teacher.userId, "update public.teacher_schedule_preferences set active_bell_schedule_id = $2 where owner_membership_id = $1", [schedule.teacher.membershipId, ALT_SCHEDULE_ID]);
    const scheduleBefore = await ownedRowCounts(schedule.teacher.membershipId);
    const scheduleStatus = await schedule.session.complete();
    check("a schedule-only change refuses completion as preferences-changed", scheduleStatus.kind === "conflict" && scheduleStatus.reason === "preferences-changed");
    check("...reporting the schedule now in force", scheduleStatus.kind === "conflict" && deepEqual(scheduleStatus.preferences, { activeBellScheduleId: ALT_SCHEDULE_ID, lunchWave: "B" }));
    check("...writing nothing", JSON.stringify(await ownedRowCounts(schedule.teacher.membershipId)) === JSON.stringify(scheduleBefore) && scheduleBefore.class_sections === 0 && scheduleBefore.teacher_period_assignments === 0);
    check("...and leaving the newer schedule active", deepEqual(await preferencesOf(schedule.teacher), { lunch_wave: "B", active_bell_schedule_id: ALT_SCHEDULE_ID }));

    // The draft is rebuilt against the schedule the teacher chose since, and then completes onto it.
    const refreshed = await loadAppData(schedule.teacher);
    const alternate = refreshed.schedules.find((candidate) => candidate.id === ALT_SCHEDULE_ID)!;
    schedule.session.update({
      ...schedule.draft,
      schedule: {
        mode: "shared",
        scheduleId: ALT_SCHEDULE_ID,
        expectedBlocks: snapshotSharedBlocks(alternate),
        assignments: [{ id: crypto.randomUUID(), blockId: alternate.blocks[0].id, classSectionId: schedule.draft.classSections[0].id }],
      },
    });
    await schedule.session.resolveConflict("keep-mine");
    check("a draft rebuilt on the newer schedule completes", (await schedule.session.complete()).kind === "completed");
    check("...with that schedule still active", deepEqual(await preferencesOf(schedule.teacher), { lunch_wave: "B", active_bell_schedule_id: ALT_SCHEDULE_ID }));

    // (c) No preferences row existed when the draft was created; the ordinary screens create one afterwards.
    const fresh = await newFounder("preferences-created-later");
    const freshDraft = ownScheduleDraft();
    const freshSeed = await fresh.repository.saveDraft(null, freshDraft);
    if (!freshSeed.ok || freshSeed.value.status !== "saved") throw new Error("could not seed the draft");
    check("with no preferences row, the baseline is 'no schedule, no lunch wave'", deepEqual(await baselineOf(fresh), { baseline_lunch_wave: "none", baseline_active_bell_schedule_id: null }));
    await db.asUser(fresh.userId, `insert into public.teacher_schedule_preferences (owner_membership_id, organization_id, lunch_wave) values ($1, $2, 'C')`, [fresh.membershipId, fresh.organizationId]);
    const freshRefused = await fresh.repository.completeSetup(freshSeed.value.operationId, freshSeed.value.revision);
    check("a lunch wave chosen afterwards, where there was no row, is also protected", freshRefused.ok && freshRefused.value.status === "conflict" && freshRefused.value.reason === "preferences-changed" && deepEqual(freshRefused.value.preferences, { activeBellScheduleId: null, lunchWave: "C" }));
    check("...and nothing was written", (await ownedRowCounts(fresh.membershipId)).class_sections === 0 && (await preferencesOf(fresh))?.lunch_wave === "C");
    // The draft itself asks for lunch wave B; put the stored value back to the baseline and it completes as before.
    await db.asUser(fresh.userId, "update public.teacher_schedule_preferences set lunch_wave = 'none' where owner_membership_id = $1", [fresh.membershipId]);
    const freshDone = await fresh.repository.completeSetup(freshSeed.value.operationId, freshSeed.value.revision);
    check("preferences that are back at the baseline do not block completion", freshDone.ok && freshDone.value.status === "completed" && deepEqual(await preferencesOf(fresh), { lunch_wave: "B", active_bell_schedule_id: freshDraft.schedule?.mode === "own" ? freshDraft.schedule.id : null }));
  }

  console.log("\n20. The rest of a shared schedule's periods is part of the change check");
  {
    const secondHour = scheduleBlockCloudId(SHARED_SCHEDULE_ID, "p2");
    const overrideId = scheduleBlockOverrideCloudId(secondHour, "ov-thu");
    const teacher = await newJoiner("lunch-window-watcher", school.organizationId);
    const session = new SetupDraftSession(teacher.repository, null, createEmptySetupDraft());
    let draft = sharedScheduleDraft(await loadAppData(teacher), "course-catalog-algebra");
    session.update(draft);
    await session.flush();

    const review = async () => {
      const refreshed = await loadAppData(teacher);
      const current = refreshed.schedules.find((candidate) => candidate.id === SHARED_SCHEDULE_ID)!;
      const stale = draft.schedule?.mode === "shared" && hasSharedScheduleChanged(draft.schedule, refreshed.schedules);
      if (draft.schedule?.mode === "shared") {
        draft = { ...draft, schedule: { ...draft.schedule, expectedBlocks: snapshotSharedBlocks(current) } };
      }
      session.update(draft);
      await session.resolveConflict("keep-mine");
      return stale;
    };
    const refusedUnchanged = async () => {
      const status = await session.complete();
      const counts = await ownedRowCounts(teacher.membershipId);
      return status.kind === "conflict" && status.reason === "shared-schedule-changed" && operationalRowTotal(counts) === 0 && counts.setup_drafts === 1;
    };

    await db.admin("update public.schedule_blocks set is_lunch_window = true where id = $1", [secondHour]);
    check("a period BECOMING the lunch window refuses completion and writes nothing", await refusedUnchanged());
    check("...and the client check sees it, against fresh data", await review());

    await db.admin("update public.schedule_blocks set custom_kind_label = 'Advisory' where id = $1", [secondHour]);
    check("a CHANGED custom kind label refuses completion", await refusedUnchanged());
    check("...and the client check sees it", await review());

    await db.admin(
      `insert into public.schedule_block_overrides (id, schedule_block_id, organization_id, owner_type, owner_membership_id, weekday, custom_kind_label)
       values ($1, $2, $3, 'organization', null, 'thursday', 'Assembly')`,
      [overrideId, secondHour, school.organizationId],
    );
    await review();
    await db.admin("update public.schedule_block_overrides set custom_kind_label = 'Pep Rally' where id = $1", [overrideId]);
    check("a CHANGED custom kind label on a weekday override refuses completion", await refusedUnchanged());
    check("...and the client check sees it", await review());

    const status = await session.complete();
    check("once the snapshot matches those fields too, the same operation completes", status.kind === "completed");
    await db.admin("delete from public.schedule_block_overrides where id = $1", [overrideId]);
    await db.admin("update public.schedule_blocks set is_lunch_window = false, custom_kind_label = null where id = $1", [secondHour]);
  }

  console.log("\n21. A shared-schedule draft that names no schedule is a validation error");
  {
    const teacher = await newJoiner("no-schedule-id", school.organizationId);
    const complete = sharedScheduleDraft(await loadAppData(teacher), "course-catalog-algebra");
    for (const [label, scheduleId] of [["missing", undefined], ["blank", "  "]] as const) {
      const broken = { ...complete, schedule: { ...complete.schedule, scheduleId } } as unknown as SetupDraft;
      const current = await stateOf(teacher);
      const saved = await teacher.repository.saveDraft(current.status === "in-progress" ? current.draft.revision : null, broken);
      if (!saved.ok || saved.value.status !== "saved") throw new Error("could not save the draft");
      const outcome = await teacher.repository.completeSetup(saved.value.operationId, saved.value.revision);
      check(`a ${label} scheduleId is rejected as a validation error, not reported as shared-schedule-changed`, !outcome.ok && outcome.kind === "rejected" && outcome.message.includes("Choose your school's schedule"));
    }
    const counts = await ownedRowCounts(teacher.membershipId);
    check("...and nothing was written", operationalRowTotal(counts) === 0 && counts.setup_completions === 0 && counts.setup_drafts === 1);
  }

  await db.close();
  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
