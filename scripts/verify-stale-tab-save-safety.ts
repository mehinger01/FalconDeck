/**
 * Regression tests for what a STALE tab can do through the ordinary save
 * engine (SupabaseDataRepository) - a tab still working from data it loaded
 * before something else changed the database: guided setup completing in
 * another tab, or simply a second ordinary tab.
 *
 * Every scenario here used to lose data. Sections 1-3 are the three
 * outcomes docs/ONBOARDING_SETUP_ARCHITECTURE.md §9.2 reproduced:
 *
 *   1. changing one preference cleared the active schedule set by setup;
 *   2. one failed save followed by another deleted the class, period
 *      assignment and first lesson setup had committed;
 *   3. the same with a private schedule deleted the first lesson and left
 *      the tab unable to save at all.
 *
 * Runs the real SupabaseDataRepository and the real complete_setup(), as
 * the teacher, under RLS, against a throwaway local PostgreSQL 17 server
 * (scripts/support/testDatabase.ts). Nothing touches Supabase.
 *
 *   npm run verify:stale-tab-save-safety
 */

import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import { SupabaseSetupRepository } from "@/lib/data/supabaseSetupRepository";
import type { AppData } from "@/lib/data/types";
import { createEmptySetupDraft } from "@/lib/onboarding/setupDraft";
import { generateId } from "@/lib/store/id";
import type { SetupDraft } from "@/types/setupDraft";
import { createTestDatabase, type RpcClient, type SelectBuilder, type TestDatabase } from "./support/testDatabase";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}
/** A fact the scenario depends on. If it does not hold the scenario is not testing what it claims, so stop. */
function precondition(label: string, holds: boolean) {
  if (!holds) throw new Error(`precondition failed: ${label}`);
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

/** An ordinary app tab: the same repository class the cloud-ready provider constructs. */
function openTab(teacher: Teacher, client: RpcClient = teacher.client): SupabaseDataRepository {
  return new SupabaseDataRepository(client as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0], {
    organizationId: teacher.organizationId,
    membershipId: teacher.membershipId,
  });
}

function ownScheduleSetupDraft(): SetupDraft {
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

function sharedScheduleSetupDraft(scheduleId: string): SetupDraft {
  const draft = ownScheduleSetupDraft();
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

async function completeGuidedSetup(teacher: Teacher, draft: SetupDraft): Promise<void> {
  const repository = new SupabaseSetupRepository(teacher.client, teacher.organizationId);
  const saved = await repository.saveDraft(null, draft);
  if (!saved.ok || saved.value.status !== "saved") throw new Error("could not save the draft");
  const completed = await repository.completeSetup(saved.value.operationId, saved.value.revision);
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

async function exists(table: string, id: string): Promise<boolean> {
  return (await db.admin(`select 1 from public.${table} where id = $1`, [id])).length === 1;
}

/**
 * A client whose next write to `table` fails once, the way a dropped
 * request would: the engine gets an error back and nothing is written.
 * `armed` can be re-set to fail a later write too.
 */
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
      rpc: (name, args) => client.rpc(name, args),
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

const withLunchWave = (data: AppData, lunchWave: AppData["teacherSchedulePreferences"]["lunchWave"]): AppData => ({
  ...data,
  teacherSchedulePreferences: { ...data.teacherSchedulePreferences, lunchWave },
});

/** Adds one course and one class section of the tab's own. Returns the new data and the two ids. */
function withOwnClass(data: AppData, name: string): { data: AppData; courseId: string; sectionId: string } {
  const courseId = generateId("course");
  const sectionId = generateId("section");
  return {
    courseId,
    sectionId,
    data: {
      ...data,
      courses: [...data.courses, { id: courseId, name }],
      classSections: [...data.classSections, { id: sectionId, courseId, name: `${name} - 1st Hour` }],
    },
  };
}

async function main() {
  db = await createTestDatabase();

  console.log("1. A stale tab changes one preference after setup completed elsewhere");
  {
    const teacher = await newFounder("one-preference");
    const tab = openTab(teacher);
    const loadedBeforeSetup = await tab.load();
    precondition("the tab loaded an empty account", loadedBeforeSetup.classSections.length === 0 && loadedBeforeSetup.teacherSchedulePreferences.activeBellScheduleId === null);

    const draft = ownScheduleSetupDraft();
    await completeGuidedSetup(teacher, draft);
    const committedSchedule = draft.schedule?.mode === "own" ? draft.schedule.id : "";
    precondition("setup committed with its schedule active", (await preferences(teacher.membershipId))?.active_bell_schedule_id === committedSchedule);

    const result = await tab.save(withLunchWave(loadedBeforeSetup, "A"));
    check("the stale tab's save succeeds", result.ok);
    const after = await preferences(teacher.membershipId);
    check("the active schedule set by setup is still set", after?.active_bell_schedule_id === committedSchedule);
    check("the tab's own edit - the lunch wave - is saved", after?.lunch_wave === "A");
    check("setup's class, schedule and lesson are untouched", (await count("class_sections", teacher.membershipId)) === 1 && (await count("bell_schedules", teacher.membershipId)) === 1 && (await count("lessons", teacher.membershipId)) === 1);
  }

  console.log("\n2. A stale tab has one failed save, then saves again (teacher uses the school's schedule)");
  {
    const scheduleId = "schedule-shared-regular";
    const teacher = await newJoinerOfSchoolWithSharedSchedule("failed-then-retry-shared", scheduleId);
    const flaky = flakyClient(teacher.client, "teacher_schedule_preferences");
    const tab = openTab(teacher, flaky.client);
    const loadedBeforeSetup = await tab.load();
    await completeGuidedSetup(teacher, sharedScheduleSetupDraft(scheduleId));
    precondition("setup committed one class, one period assignment, one lesson", (await count("class_sections", teacher.membershipId)) === 1 && (await count("teacher_period_assignments", teacher.membershipId)) === 1 && (await count("lessons", teacher.membershipId)) === 1);

    const edited = withLunchWave(loadedBeforeSetup, "A");
    flaky.failNext();
    precondition("the first save fails", !(await tab.save(edited)).ok);
    precondition("...having written nothing (the lunch wave is still the one setup committed)", (await preferences(teacher.membershipId))?.lunch_wave === "B");

    const retry = await tab.save(edited);
    check("the retry succeeds", retry.ok);
    check("the period assignment committed by setup survives", (await count("teacher_period_assignments", teacher.membershipId)) === 1);
    check("the first lesson committed by setup survives", (await count("lessons", teacher.membershipId)) === 1 && (await count("lesson_class_sections", teacher.membershipId)) === 1);
    check("the class committed by setup survives", (await count("class_sections", teacher.membershipId)) === 1);
    const after = await preferences(teacher.membershipId);
    check("the active schedule is still the school's", after?.active_bell_schedule_id === scheduleId);
    check("the unsaved edit from the failed save is now saved", after?.lunch_wave === "A");
  }

  console.log("\n3. The same, when the teacher built their own schedule");
  {
    const teacher = await newFounder("failed-then-retry-own");
    const flaky = flakyClient(teacher.client, "teacher_schedule_preferences");
    const tab = openTab(teacher, flaky.client);
    const loadedBeforeSetup = await tab.load();
    const draft = ownScheduleSetupDraft();
    await completeGuidedSetup(teacher, draft);

    const edited = withLunchWave(loadedBeforeSetup, "A");
    flaky.failNext();
    precondition("the first save fails", !(await tab.save(edited)).ok);

    check("the retry succeeds - it no longer runs into the private schedule's foreign key", (await tab.save(edited)).ok);
    check("the first lesson committed by setup survives", (await count("lessons", teacher.membershipId)) === 1);
    check("the class, schedule and its block survive", (await count("class_sections", teacher.membershipId)) === 1 && (await count("bell_schedules", teacher.membershipId)) === 1 && (await count("schedule_blocks", teacher.membershipId)) === 1);
    const after = await preferences(teacher.membershipId);
    check("the private schedule is still active, and the lunch wave edit is saved", after?.active_bell_schedule_id === (draft.schedule?.mode === "own" ? draft.schedule.id : "") && after?.lunch_wave === "A");
    check("later saves from that tab keep working", (await tab.save(withLunchWave(edited, "C"))).ok && (await preferences(teacher.membershipId))?.lunch_wave === "C");
  }

  console.log("\n4. Unsaved edits are preserved through recovery");
  {
    const teacher = await newFounder("preserve-edits");
    const flaky = flakyClient(teacher.client, "class_sections");
    const tab = openTab(teacher, flaky.client);
    const loaded = await tab.load();
    await completeGuidedSetup(teacher, ownScheduleSetupDraft());

    // One edit: a new course and class of the tab's own, plus a lunch wave.
    const first = withOwnClass(withLunchWave(loaded, "A"), "Algebra");
    flaky.failNext();
    precondition("the save fails partway - after the course was written, at the class", !(await tab.save(first.data)).ok);
    precondition("...leaving a half-written state: the course exists, its class does not", (await exists("courses", first.courseId)) && !(await exists("class_sections", first.sectionId)));

    // The teacher keeps working before the retry: one more class.
    const second = withOwnClass(first.data, "Biology");
    check("the next save succeeds", (await tab.save(second.data)).ok);
    check("the edit from the failed save is saved in full", (await exists("courses", first.courseId)) && (await exists("class_sections", first.sectionId)));
    check("the edit made after the failure is saved too", (await exists("courses", second.courseId)) && (await exists("class_sections", second.sectionId)));
    check("the lunch wave from the failed save is saved", (await preferences(teacher.membershipId))?.lunch_wave === "A");
    check("setup's own class and lesson are still there alongside them", (await count("class_sections", teacher.membershipId)) === 3 && (await count("lessons", teacher.membershipId)) === 1);

    const [reloaded, memory] = [await openTab(teacher).load(), second.data];
    check("a fresh load contains everything the tab had in memory", memory.classSections.every((section) => reloaded.classSections.some((candidate) => candidate.id === section.id)) && memory.courses.every((course) => reloaded.courses.some((candidate) => candidate.id === course.id)));
  }

  console.log("\n5. A half-written save is still corrected from the truth");
  {
    const teacher = await newFounder("half-written");
    const flaky = flakyClient(teacher.client, "class_sections");
    const tab = openTab(teacher, flaky.client);
    const loaded = await tab.load();

    // The failed save wrote a course. Before retrying, the teacher removes it again.
    const attempted = withOwnClass(loaded, "Chemistry");
    flaky.failNext();
    precondition("the save fails after writing the course", !(await tab.save(attempted.data)).ok && (await exists("courses", attempted.courseId)));
    check("retrying WITHOUT that course succeeds", (await tab.save(loaded)).ok);
    check("...and removes the half-written course rather than leaving an orphan", !(await exists("courses", attempted.courseId)));

    // A preference the failed save may have written, then reverted before the retry.
    const flakyLessons = flakyClient(teacher.client, "class_sections");
    const second = openTab(teacher, flakyLessons.client);
    const base = await second.load();
    const changed = withOwnClass(withLunchWave(base, "B"), "Physics");
    // Courses are written first, classes second, preferences last - so
    // failing at the class leaves the preference unwritten; write it the
    // way a slower, partially-applied attempt would have.
    flakyLessons.failNext();
    precondition("the save fails", !(await second.save(changed.data)).ok);
    await db.admin("insert into public.teacher_schedule_preferences (owner_membership_id, organization_id, lunch_wave) values ($1, $2, 'B') on conflict (owner_membership_id) do update set lunch_wave = 'B'", [teacher.membershipId, teacher.organizationId]);
    check("retrying with the preference put back to 'none' succeeds", (await second.save(base)).ok);
    check("...and the database ends at 'none', not at the half-written 'B'", (await preferences(teacher.membershipId))?.lunch_wave === "none");
    check("...with the abandoned course removed", !(await exists("courses", changed.courseId)));
  }

  console.log("\n6. Two ordinary tabs, no guided setup involved");
  {
    const teacher = await newFounder("two-tabs");
    const flaky = flakyClient(teacher.client, "teacher_schedule_preferences");
    const staleTab = openTab(teacher, flaky.client);
    const staleData = await staleTab.load();

    // The other tab adds a class and saves normally.
    const otherTab = openTab(teacher);
    const other = withOwnClass(await otherTab.load(), "History");
    precondition("the other tab's save succeeds", (await otherTab.save(other.data)).ok);

    const mine = withOwnClass(withLunchWave(staleData, "A"), "Art");
    flaky.failNext();
    precondition("the stale tab's first save fails", !(await staleTab.save(mine.data)).ok);
    check("the stale tab's retry succeeds", (await staleTab.save(mine.data)).ok);
    check("the class the OTHER tab added survives", (await exists("class_sections", other.sectionId)) && (await exists("courses", other.courseId)));
    check("the stale tab's own class is saved", (await exists("class_sections", mine.sectionId)));
    check("both tabs' work is present in a fresh load", (await openTab(teacher).load()).classSections.length === 2);
  }

  console.log("\n7. A tab can still delete what it knows about - and only that");
  {
    const teacher = await newFounder("deletes");
    const tab = openTab(teacher);
    const mine = withOwnClass(await tab.load(), "Music");
    precondition("the tab saves its own class", (await tab.save(mine.data)).ok);

    const otherTab = openTab(teacher);
    const elsewhere = withOwnClass(await otherTab.load(), "Drama");
    precondition("another tab adds a second class", (await otherTab.save(elsewhere.data)).ok);

    const emptied: AppData = { ...mine.data, courses: [], classSections: [] };
    check("deleting its own class succeeds", (await tab.save(emptied)).ok);
    check("its own class and course are gone", !(await exists("class_sections", mine.sectionId)) && !(await exists("courses", mine.courseId)));
    check("the class it never loaded is still there", (await exists("class_sections", elsewhere.sectionId)) && (await exists("courses", elsewhere.courseId)));
  }

  console.log("\n8. Limits that remain, stated as tests");
  {
    const teacher = await newFounder("limits");
    const tab = openTab(teacher);
    const loaded = await tab.load();
    await completeGuidedSetup(teacher, ownScheduleSetupDraft());

    // Saving with nothing changed writes nothing at all.
    await tab.save(structuredClone(loaded));
    const untouched = await preferences(teacher.membershipId);
    check("a save with no edits leaves setup's preferences exactly as committed", untouched?.lunch_wave === "B" && untouched.active_bell_schedule_id !== null);

    // A field the stale tab's user DOES edit is still last-write-wins.
    await tab.save(withLunchWave(loaded, "C"));
    check("a field the tab explicitly edits overwrites the newer value (last write wins, per field)", (await preferences(teacher.membershipId))?.lunch_wave === "C");

    // The stale tab still cannot SEE what it never loaded.
    check("the stale tab's memory still has no classes - only a reload shows setup's data", loaded.classSections.length === 0 && (await openTab(teacher).load()).classSections.length === 1);
    const state = await new SupabaseSetupRepository(teacher.client, teacher.organizationId).getState();
    check("setup is still recorded as completed", state.ok && state.value.status === "completed");
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
