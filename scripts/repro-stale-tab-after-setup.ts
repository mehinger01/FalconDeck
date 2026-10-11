/**
 * REPRODUCTION, NOT A SAFEGUARD. This script demonstrates an UNRESOLVED
 * risk (docs/ONBOARDING_SETUP_ARCHITECTURE.md §9.2) and exits 0 when the
 * risk reproduces. It is deliberately not part of `npm run verify`: a
 * passing run here means the problem still exists.
 *
 * The situation: an ordinary Falcon Deck tab (the general app, backed by
 * the real SupabaseDataRepository) was loaded BEFORE guided setup
 * completed in another tab. It then keeps working from what it loaded.
 *
 * It uses the real SupabaseDataRepository and the real complete_setup(),
 * as the teacher, under RLS, against a throwaway local PostgreSQL 17
 * server (scripts/support/testDatabase.ts). Nothing touches Supabase.
 *
 * When a protection is implemented, this file becomes its test: flip the
 * expectations so that each "REPRODUCED" line must instead be prevented.
 *
 *   npm run repro:stale-tab-after-setup
 */

import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import { SupabaseSetupRepository } from "@/lib/data/supabaseSetupRepository";
import type { AppData } from "@/lib/data/types";
import { createEmptySetupDraft } from "@/lib/onboarding/setupDraft";
import { generateId } from "@/lib/store/id";
import type { SetupDraft } from "@/types/setupDraft";
import { createTestDatabase, type RpcClient, type TestDatabase } from "./support/testDatabase";

let unexpected = 0;
function observe(label: string, reproduced: boolean) {
  if (reproduced) {
    console.log(`  REPRODUCED - ${label}`);
  } else {
    unexpected += 1;
    console.error(`  NOT REPRODUCED - ${label}`);
  }
}
function precondition(label: string, holds: boolean) {
  if (!holds) throw new Error(`precondition failed: ${label}`);
  console.log(`  (setup)    - ${label}`);
}

let db: TestDatabase;

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
  const [row] = await db.admin<{ id: string; organization_id: string }>(
    "select id, organization_id from public.organization_memberships where user_id = $1",
    [userId],
  );
  return { userId, organizationId: row.organization_id, membershipId: row.id, client };
}

function ordinaryTab(teacher: Teacher, client: RpcClient = teacher.client): SupabaseDataRepository {
  return new SupabaseDataRepository(client as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0], {
    organizationId: teacher.organizationId,
    membershipId: teacher.membershipId,
  });
}

function setupDraft(): SetupDraft {
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

/** A school with one shared schedule (id `scheduleId`), and a brand-new teacher who has joined it. */
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

/** The same draft, but using the school's schedule: one period assignment instead of a private schedule. */
function sharedSetupDraft(scheduleId: string): SetupDraft {
  const draft = setupDraft();
  return {
    ...draft,
    schedule: {
      mode: "shared",
      scheduleId,
      expectedBlocks: [{ id: "p1", label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", overrides: [] }],
      assignments: [{ id: crypto.randomUUID(), blockId: "p1", classSectionId: draft.classSections[0].id }],
    },
  };
}

async function completeGuidedSetup(teacher: Teacher, draft: SetupDraft = setupDraft()): Promise<SetupDraft> {
  const repository = new SupabaseSetupRepository(teacher.client, teacher.organizationId);
  const saved = await repository.saveDraft(null, draft);
  if (!saved.ok || saved.value.status !== "saved") throw new Error("could not save the draft");
  const completed = await repository.completeSetup(saved.value.operationId, saved.value.revision);
  if (!completed.ok || completed.value.status !== "completed") throw new Error("setup did not complete");
  return draft;
}

async function count(table: string, membershipId: string): Promise<number> {
  const [row] = await db.admin<{ count: number }>(`select count(*)::int as count from public.${table} where owner_membership_id = $1`, [membershipId]);
  return row.count;
}

async function activeSchedule(membershipId: string): Promise<string | null> {
  const [row] = await db.admin<{ active_bell_schedule_id: string | null }>(
    "select active_bell_schedule_id from public.teacher_schedule_preferences where owner_membership_id = $1",
    [membershipId],
  );
  return row?.active_bell_schedule_id ?? null;
}

/** A client whose next write to `table` fails once, the way a dropped connection would. */
function failNextWrite(client: RpcClient, table: string): RpcClient {
  let armed = true;
  return {
    rpc: (name, args) => client.rpc(name, args),
    from(name) {
      const builder = client.from(name);
      if (name !== table) return builder;
      const upsert = builder.upsert.bind(builder);
      builder.upsert = (rows) => {
        if (!armed) return upsert(rows);
        armed = false;
        const failed = { data: null, error: { message: "TypeError: Failed to fetch" } };
        return { ...builder, then: (resolve: (value: typeof failed) => unknown) => Promise.resolve(failed).then(resolve) } as typeof builder;
      };
      return builder;
    },
  };
}

async function main() {
  db = await createTestDatabase();

  console.log("A. A stale ordinary tab changes one preference after setup completed elsewhere");
  {
    const teacher = await newFounder("stale-preferences");
    const tab = ordinaryTab(teacher);
    const loadedBeforeSetup: AppData = await tab.load();
    precondition("the ordinary tab loaded while the account was still empty", loadedBeforeSetup.classSections.length === 0 && loadedBeforeSetup.teacherSchedulePreferences.activeBellScheduleId === null);

    const draft = await completeGuidedSetup(teacher);
    const committedSchedule = draft.schedule?.mode === "own" ? draft.schedule.id : null;
    precondition("guided setup committed, with its schedule active", (await activeSchedule(teacher.membershipId)) === committedSchedule && committedSchedule !== null);

    // The teacher, in the old tab, sets their lunch wave. Nothing else.
    const result = await tab.save({
      ...loadedBeforeSetup,
      teacherSchedulePreferences: { ...loadedBeforeSetup.teacherSchedulePreferences, lunchWave: "A" },
    });
    precondition("the stale tab's save is accepted", result.ok);
    observe("the committed active schedule is overwritten with the stale tab's 'none chosen'", (await activeSchedule(teacher.membershipId)) === null);
    observe("...while the classes and schedule themselves are still there (this step only clobbers the one row)", (await count("class_sections", teacher.membershipId)) === 1 && (await count("bell_schedules", teacher.membershipId)) === 1);
  }

  console.log("\nB. A stale ordinary tab has one failed save, then saves again (teacher uses the school's schedule)");
  {
    const scheduleId = "schedule-shared-regular";
    const teacher = await newJoinerOfSchoolWithSharedSchedule("stale-shared", scheduleId);
    const tab = ordinaryTab(teacher, failNextWrite(teacher.client, "teacher_schedule_preferences"));
    const loadedBeforeSetup: AppData = await tab.load();
    await completeGuidedSetup(teacher, sharedSetupDraft(scheduleId));
    precondition("guided setup committed one class, one period assignment, one lesson", (await count("class_sections", teacher.membershipId)) === 1 && (await count("teacher_period_assignments", teacher.membershipId)) === 1 && (await count("lessons", teacher.membershipId)) === 1);

    const edited = { ...loadedBeforeSetup, teacherSchedulePreferences: { ...loadedBeforeSetup.teacherSchedulePreferences, lunchWave: "A" as const } };
    const first = await tab.save(edited);
    precondition("the first save fails (simulated dropped request)", !first.ok);

    // After any failure the repository discards its baseline and re-reads
    // the database - which now contains setup's rows - then diffs that
    // against this tab's memory, which does not. Everything this tab has
    // never heard of looks "removed".
    const second = await tab.save(edited);
    precondition("the second save is accepted", second.ok);
    observe("the period assignment committed by setup is DELETED", (await count("teacher_period_assignments", teacher.membershipId)) === 0);
    observe("the first lesson committed by setup is DELETED", (await count("lessons", teacher.membershipId)) === 0);
    observe("the class committed by setup is DELETED", (await count("class_sections", teacher.membershipId)) === 0);
    observe("the active schedule is cleared", (await activeSchedule(teacher.membershipId)) === null);
  }

  console.log("\nB2. The same, when the teacher built their own schedule");
  {
    const teacher = await newFounder("stale-own");
    const tab = ordinaryTab(teacher, failNextWrite(teacher.client, "teacher_schedule_preferences"));
    const loadedBeforeSetup: AppData = await tab.load();
    await completeGuidedSetup(teacher);
    const edited = { ...loadedBeforeSetup, teacherSchedulePreferences: { ...loadedBeforeSetup.teacherSchedulePreferences, lunchWave: "A" as const } };
    precondition("the first save fails (simulated dropped request)", !(await tab.save(edited)).ok);

    const second = await tab.save(edited);
    observe("the first lesson committed by setup is DELETED", (await count("lessons", teacher.membershipId)) === 0);
    observe("the save then FAILS partway, at the private schedule (still referenced as the active schedule)", !second.ok && second.message.includes("active_bell_schedule_id_same_org_fkey"));
    observe("...which is the only reason the class and schedule survive", (await count("class_sections", teacher.membershipId)) === 1 && (await count("bell_schedules", teacher.membershipId)) === 1);
    observe("...and every later save from that tab fails the same way", !(await tab.save(edited)).ok);
  }

  console.log("\nC. What is NOT at risk");
  {
    const teacher = await newFounder("stale-not-at-risk");
    const tab = ordinaryTab(teacher);
    const loadedBeforeSetup = await tab.load();
    await completeGuidedSetup(teacher);
    await tab.save({ ...loadedBeforeSetup, teacherSchedulePreferences: { ...loadedBeforeSetup.teacherSchedulePreferences, lunchWave: "A" } });
    const state = await new SupabaseSetupRepository(teacher.client, teacher.organizationId).getState();
    observe("the completion record itself survives - setup is still 'completed' and cannot be run twice", state.ok && state.value.status === "completed" && (await count("setup_completions", teacher.membershipId)) === 1);

    const fresh = ordinaryTab(teacher);
    const reloaded = await fresh.load();
    await fresh.save({ ...reloaded, teacherSchedulePreferences: { ...reloaded.teacherSchedulePreferences, lunchWave: "C" } });
    observe("a tab loaded AFTER completion edits preferences without losing anything", (await count("class_sections", teacher.membershipId)) === 1 && (await count("lessons", teacher.membershipId)) === 1);
  }

  await db.close();
  console.log(
    unexpected === 0
      ? "\nRisk reproduced as documented. It is UNRESOLVED - see docs/ONBOARDING_SETUP_ARCHITECTURE.md §9.2."
      : `\n${unexpected} observation(s) did not reproduce - the behavior has changed; update the architecture document and this script.`,
  );
  process.exit(unexpected === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db?.close().catch(() => {});
  process.exit(1);
});
