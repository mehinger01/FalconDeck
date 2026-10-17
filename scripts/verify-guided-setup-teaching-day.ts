/**
 * Guided setup, stage 1 ("Your teaching day"): the server-side switch, the
 * entry decision, the screen's pure draft transforms, and real draft
 * persistence through SetupDraftSession + save_setup_draft against a
 * throwaway local PostgreSQL 17 (scripts/support/testDatabase.ts). Never
 * touches the linked Supabase project.
 *
 *   npm run verify:guided-setup-teaching-day
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { deriveDataAuthorityState, type DataAuthorityState } from "@/lib/auth/dataAuthority";
import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import { deepEqual } from "@/lib/data/supabaseMapping";
import { SupabaseSetupRepository, type SetupRpcClient } from "@/lib/data/supabaseSetupRepository";
import type { AppData } from "@/lib/data/types";
import { guidedSetupEntry, isGuidedSetupEnabled } from "@/lib/onboarding/guidedSetupFlag";
import { createEmptySetupDraft, createSetupDraftFromSeed } from "@/lib/onboarding/setupDraft";
import { SetupDraftSession } from "@/lib/onboarding/setupDraftSession";
import type { SetupRepository, SetupState } from "@/lib/onboarding/setupRepository";
import {
  addOwnBlock,
  adoptReportedPreferences,
  buildQuickSchedulePeriods,
  chooseSharedSchedule,
  courseIdForPeriod,
  lunchApplies,
  refreshSharedSchedule,
  removeOwnBlock,
  setPeriodCourse,
  startOwnSchedule,
  summarizeDraft,
  teachingDayIssues,
  teachingDayPeriods,
  updateOwnBlock,
} from "@/lib/onboarding/teachingDay";
import type { Course } from "@/types/course";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft, SetupSeed } from "@/types/setupDraft";
import { saveIndicator } from "@/components/guided/SaveStatus";
import { createTestDatabase, type RpcClient, type TestDatabase } from "./support/testDatabase";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok  - ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  - ${label}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  }
}

let counter = 0;
const ids = (prefix: string) => `${prefix}-t${(counter += 1)}`;
const uuid = () => crypto.randomUUID();

function sharedSchedule(id: string, name: string, extra: Partial<BellSchedule> = {}): BellSchedule {
  return {
    id,
    name,
    ownerType: "organization",
    isDefault: false,
    timeZone: "America/Detroit",
    source: "built-in",
    blocks: [
      { id: "p1", label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", overrides: [] },
      { id: "p2", label: "2nd Hour", kind: "instructional", startTime: "08:55", endTime: "09:45", overrides: [] },
      { id: "l", label: "Lunch", kind: "lunch", startTime: "11:00", endTime: "11:30", overrides: [] },
      { id: "p3", label: "3rd Hour", kind: "instructional", startTime: "11:35", endTime: "12:25", overrides: [], isLunchWindow: true },
    ],
    ...extra,
  };
}

const CLOUD: DataAuthorityState = { kind: "cloud-ready", organizationId: "o", membershipId: "m", migratedAt: null };
const LOCAL: DataAuthorityState = { kind: "local", organizationId: "o", membershipId: "m", migratedAt: null };
const EMPTY_SEED: SetupSeed = { activeBellScheduleId: null, lunchWave: "none" };
const NOT_STARTED: SetupState = { status: "not-started", eligible: true, reason: null, seed: EMPTY_SEED };
const INELIGIBLE: SetupState = { status: "not-started", eligible: false, reason: "existing-setup", seed: EMPTY_SEED };

function pureChecks() {
  console.log("1. Server-side switch");
  check("off when unset", !isGuidedSetupEnabled({}));
  check("on only for the exact value \"on\"", isGuidedSetupEnabled({ FALCON_GUIDED_SETUP: "on" }) && !isGuidedSetupEnabled({ FALCON_GUIDED_SETUP: "true" }) && !isGuidedSetupEnabled({ FALCON_GUIDED_SETUP: "1" }));
  check("on in a Vercel preview", isGuidedSetupEnabled({ FALCON_GUIDED_SETUP: "on", VERCEL_ENV: "preview" }));
  check("always off in a Vercel production deployment, even when set", !isGuidedSetupEnabled({ FALCON_GUIDED_SETUP: "on", VERCEL_ENV: "production" }));

  console.log("2. Entry decision");
  check("switch off: an eligible new account keeps the existing flow", guidedSetupEntry(false, CLOUD, NOT_STARTED) === "existing-app");
  check("switch on: an eligible new account gets guided setup", guidedSetupEntry(true, CLOUD, NOT_STARTED) === "guided-setup");
  check("switch on: a legacy account with migration pending keeps the existing flow", guidedSetupEntry(true, LOCAL, NOT_STARTED) === "existing-app");
  check("switch on: an established account (ineligible) keeps the existing flow", guidedSetupEntry(true, CLOUD, INELIGIBLE) === "existing-app");
  check("switch on: unreadable setup state keeps the existing flow", guidedSetupEntry(true, CLOUD, null) === "existing-app");

  console.log("3. Quick schedule builder");
  const built = buildQuickSchedulePeriods({ periodCount: 3, firstStart: "08:00", periodMinutes: 50, passingMinutes: 5 }, ids);
  check("lays out exactly the periods described", built.ok && built.blocks.length === 3);
  check("times follow from the teacher's numbers", built.ok && deepEqual(built.blocks.map((b) => [b.startTime, b.endTime]), [["08:00", "08:50"], ["08:55", "09:45"], ["09:50", "10:40"]]));
  check("every generated period starts unassigned and named", built.ok && built.blocks.every((b) => b.classSectionId === null && b.label.startsWith("Period ")));
  check("no start time typed: refused, nothing invented", !buildQuickSchedulePeriods({ periodCount: 3, firstStart: "", periodMinutes: 50, passingMinutes: 5 }).ok);
  check("no passing time typed: refused", !buildQuickSchedulePeriods({ periodCount: 3, firstStart: "08:00", periodMinutes: 50, passingMinutes: Number.NaN }).ok);
  check("a day running past midnight: refused", !buildQuickSchedulePeriods({ periodCount: 12, firstStart: "20:00", periodMinutes: 60, passingMinutes: 5 }).ok);

  console.log("4. Built periods are editable and checked by the existing schedule validator");
  if (!built.ok) throw new Error("builder failed");
  let own = startOwnSchedule(createEmptySetupDraft(), { name: "My Day", timeZone: "America/Detroit", blocks: built.blocks }, ids);
  own = setPeriodCourse(own, built.blocks[0].id, { kind: "new", name: "Geometry" }, [], ids, uuid);
  check("a built schedule with one class has no teaching-day issues", teachingDayIssues(own, { courses: [], schedules: [] }).length === 0, teachingDayIssues(own, { courses: [], schedules: [] }));
  const overlapping = updateOwnBlock(own, built.blocks[1].id, { startTime: "08:30" });
  check("an edit that overlaps two periods is reported by validateSchedule", teachingDayIssues(overlapping, { courses: [], schedules: [] }).some((i) => /overlaps/.test(i.message)));
  const backwards = updateOwnBlock(own, built.blocks[2].id, { endTime: "09:00" });
  check("an edit that ends a period before it starts is reported", teachingDayIssues(backwards, { courses: [], schedules: [] }).some((i) => /ends at or before/.test(i.message)));
  const renamed = updateOwnBlock(own, built.blocks[0].id, { label: "Homeroom" });
  check("renaming a period renames its class", renamed.classSections[0]?.name === "Geometry — Homeroom");
  const toLunch = updateOwnBlock(own, built.blocks[0].id, { kind: "lunch" });
  check("making a period lunch removes its class and the now-unused course", toLunch.classSections.length === 0 && toLunch.courses.length === 0);
  const added = addOwnBlock(own, ids);
  check("adding a period copies the last period's length after it", added.schedule?.mode === "own" && added.schedule.blocks.length === 4 && deepEqual([added.schedule.blocks[3].startTime, added.schedule.blocks[3].endTime], ["10:40", "11:30"]));
  const removed = removeOwnBlock(own, built.blocks[0].id);
  check("removing a period removes its class", removed.classSections.length === 0 && removed.schedule?.mode === "own" && removed.schedule.blocks.length === 2);

  console.log("5. Classes mapped to periods, with reusable courses");
  const regular = sharedSchedule("s-regular", "Regular Day");
  const late = sharedSchedule("s-late", "Late Start");
  const school: Course[] = [{ id: "c-school-algebra", name: "Algebra 1" }];
  let d = chooseSharedSchedule(createEmptySetupDraft(), regular);
  d = setPeriodCourse(d, "p1", { kind: "new", name: "Geometry" }, school, ids, uuid);
  const geometryId = d.courses[0]?.id;
  check("a new course creates one course and one class named for the period", d.courses.length === 1 && d.classSections.length === 1 && d.classSections[0].name === "Geometry — 1st Hour");
  d = setPeriodCourse(d, "p3", { kind: "course", courseId: geometryId }, school, ids, uuid);
  check("picking the same course for another period reuses it: one course, two classes", d.courses.length === 1 && d.classSections.length === 2);
  d = setPeriodCourse(d, "p2", { kind: "new", name: "  geometry " }, school, ids, uuid);
  check("typing an existing course's name again reuses it instead of duplicating", d.courses.length === 1 && d.classSections.length === 3);
  const p1Assignment = d.schedule?.mode === "shared" ? d.schedule.assignments.find((a) => a.blockId === "p1")?.id : undefined;
  d = setPeriodCourse(d, "p2", { kind: "course", courseId: "c-school-algebra" }, school, ids, uuid);
  check("a school catalog course adds a class but no draft course", d.courses.length === 1 && d.classSections.some((s) => s.courseId === "c-school-algebra" && s.name === "Algebra 1 — 2nd Hour"));
  check("assignment ids are UUIDs and survive unrelated edits", d.schedule?.mode === "shared" && /^[0-9a-f-]{36}$/.test(p1Assignment ?? "") && d.schedule.assignments.find((a) => a.blockId === "p1")?.id === p1Assignment);
  check("lunch periods cannot hold a class", deepEqual(setPeriodCourse(d, "l", { kind: "new", name: "Art" }, school, ids, uuid), d));
  d = setPeriodCourse(setPeriodCourse(d, "p1", { kind: "none" }, school, ids, uuid), "p3", { kind: "none" }, school, ids, uuid);
  check("clearing every period that used a course removes the course", d.courses.length === 0 && d.classSections.length === 1);
  check("a period's course reads back from its class", courseIdForPeriod(d, teachingDayPeriods(d).find((p) => p.blockId === "p2")!) === "c-school-algebra");

  console.log("6. School schedule selection and lunch");
  const seeded = createSetupDraftFromSeed(EMPTY_SEED, [sharedSchedule("s-rec", "Recommended", { isDefault: true }), regular]);
  check("no schedule is selected automatically - not even the school's recommended one", seeded.schedule === null);
  const fromSeed = createSetupDraftFromSeed({ activeBellScheduleId: "s-regular", lunchWave: "B" }, [regular]);
  check("a schedule the teacher already chose elsewhere comes back selected, with their lunch wave", fromSeed.schedule?.mode === "shared" && fromSeed.schedule.scheduleId === "s-regular" && fromSeed.lunchWave === "B");
  const switched = chooseSharedSchedule(setPeriodCourse(chooseSharedSchedule(createEmptySetupDraft(), regular), "p1", { kind: "new", name: "Geometry" }, [], ids, uuid), late);
  check("switching schedules drops classes placed in the old one", switched.schedule?.mode === "shared" && switched.schedule.scheduleId === "s-late" && switched.classSections.length === 0 && switched.courses.length === 0);
  check("an unusable school schedule cannot be chosen", chooseSharedSchedule(createEmptySetupDraft(), sharedSchedule("s-empty", "Empty", { blocks: [] })).schedule === null);
  check("lunch is asked about only when the school schedule has a lunch window", lunchApplies(chooseSharedSchedule(createEmptySetupDraft(), regular)) && !lunchApplies(own));

  console.log("7. Recovery transforms");
  let mapped = setPeriodCourse(setPeriodCourse(chooseSharedSchedule(createEmptySetupDraft(), regular), "p1", { kind: "new", name: "Geometry" }, [], ids, uuid), "p2", { kind: "new", name: "Biology" }, [], ids, uuid);
  const edited = sharedSchedule("s-regular", "Regular Day", {
    blocks: [
      { id: "p1", label: "Period 1", kind: "instructional", startTime: "08:05", endTime: "08:55", overrides: [] },
      { id: "p3", label: "3rd Hour", kind: "instructional", startTime: "11:35", endTime: "12:25", overrides: [] },
    ],
  });
  const refreshed = refreshSharedSchedule(mapped, [edited]);
  check("refresh keeps classes in periods that still exist, renamed with the period", refreshed.draft.classSections.some((s) => s.name === "Geometry — Period 1"));
  check("refresh removes classes in periods that are gone, and reports them", !refreshed.draft.classSections.some((s) => s.name.startsWith("Biology")) && deepEqual(refreshed.removedPeriods, ["2nd Hour"]));
  check("refreshed snapshot equals the school's current schedule", teachingDayIssues(refreshed.draft, { courses: [], schedules: [edited] }).every((i) => !/changed/.test(i.message)));
  mapped = { ...mapped, lunchWave: "A" };
  const adopted = adoptReportedPreferences(mapped, { activeBellScheduleId: "s-late", lunchWave: "C" }, [regular, late]);
  check("adopting changed preferences switches to the schedule now active and its lunch wave", adopted.schedule?.mode === "shared" && adopted.schedule.scheduleId === "s-late" && adopted.lunchWave === "C");
  const sameSchedule = adoptReportedPreferences(mapped, { activeBellScheduleId: "s-regular", lunchWave: "C" }, [regular, late]);
  check("adopting a lunch-only change keeps the classes", sameSchedule.classSections.length === 2 && sameSchedule.lunchWave === "C");
  check("a conflict summary includes the lunch wave", summarizeDraft(mapped, [regular]).lunchWave === "A" && summarizeDraft(mapped, [regular]).scheduleName === "Regular Day");

  console.log("7b. What the save indicator says");
  const label = (...args: Parameters<typeof saveIndicator>) => saveIndicator(...args).label;
  check("fresh, untouched: nothing to save", label({ kind: "idle" }, false, false) === "Nothing to save yet");
  check("resumed, untouched: already saved (not \"nothing to save\")", label({ kind: "idle" }, false, false, true) === "All changes saved");
  check("typing not yet committed: unsaved", label({ kind: "saved" }, false, true) === "Unsaved changes…");
  check("edit waiting to save: unsaved, never \"saved\"", label({ kind: "saved" }, true, false, true) === "Unsaved changes…");
  check("in flight: saving", label({ kind: "saving" }, false, false) === "Saving…");
  const failedIndicator = saveIndicator({ kind: "save-failed", message: "TypeError: Failed to fetch" }, true, false, true);
  check("failed: \"Not saved\" with Retry, and no raw error text", failedIndicator.label === "Not saved" && failedIndicator.tone === "warn" && failedIndicator.canRetry && !("detail" in failedIndicator && failedIndicator.detail));
  check("conflict: not saved, needs a choice, no Retry", label({ kind: "conflict", reason: "stale-revision", serverDraft: null }, true, false) === "Not saved — needs your choice");
}

// ---------------------------------------------------------------------------

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
  const [row] = await db.admin<{ id: string; organization_id: string }>("select id, organization_id from public.organization_memberships where user_id = $1", [userId]);
  return { userId, organizationId: row.organization_id, membershipId: row.id, client, repository: new SupabaseSetupRepository(client as unknown as SetupRpcClient, row.organization_id) };
}

async function operationalRows(membershipId: string): Promise<number> {
  const tables = ["courses", "class_sections", "bell_schedules", "schedule_blocks", "teacher_period_assignments", "lessons", "teacher_schedule_preferences"];
  let total = 0;
  for (const table of tables) {
    const [row] = await db.admin<{ n: number }>(`select count(*)::int as n from public.${table} where owner_membership_id = $1`, [membershipId]);
    total += row.n;
  }
  return total;
}

function ownDraftWithClass(): SetupDraft {
  const built = buildQuickSchedulePeriods({ periodCount: 2, firstStart: "08:00", periodMinutes: 50, passingMinutes: 5 });
  if (!built.ok) throw new Error("builder failed");
  const draft = startOwnSchedule(createEmptySetupDraft(), { name: "My Day", timeZone: "America/Detroit", blocks: built.blocks });
  return setPeriodCourse(draft, built.blocks[0].id, { kind: "new", name: "Geometry" }, []);
}

/** A repository whose saves fail with "no usable answer" while `failing` is true - like a dropped connection. */
function flakyRepository(inner: SetupRepository): SetupRepository & { failing: boolean } {
  const wrapper = {
    failing: false,
    getState: () => inner.getState(),
    completeSetup: (operationId: string, revision: number) => inner.completeSetup(operationId, revision),
    saveDraft: async (revision: number | null, payload: SetupDraft, seed: SetupSeed | null) =>
      wrapper.failing ? ({ ok: false, kind: "unknown", message: "Network request failed." } as const) : inner.saveDraft(revision, payload, seed),
  };
  return wrapper;
}

async function databaseChecks() {
  console.log("8. Draft edits persist and survive reload, without creating operational records");
  const a = await newFounder("guided-a");
  const state = await a.repository.getState();
  if (!state.ok || state.value.status !== "not-started") throw new Error("expected not-started");
  const session = new SetupDraftSession(a.repository, null, createSetupDraftFromSeed(state.value.seed, []), state.value.seed);
  check("opening the screen saves nothing", (await a.repository.getState()).ok && ((await a.repository.getState()) as { value: SetupState }).value.status === "not-started");
  const draft = ownDraftWithClass();
  session.update(draft);
  await session.flush();
  check("an edit is saved (status saved, nothing dirty)", session.getSnapshot().status.kind === "saved" && !session.getSnapshot().dirty);
  const reloaded = await a.repository.getState();
  check("reload: the draft comes back exactly as edited", reloaded.ok && reloaded.value.status === "in-progress" && deepEqual(reloaded.value.draft.payload, draft));
  check("no course, class, schedule, block, assignment, lesson or preference row exists", (await operationalRows(a.membershipId)) === 0);
  if (!reloaded.ok || reloaded.value.status !== "in-progress") throw new Error("no draft");
  const resumed = new SetupDraftSession(a.repository, reloaded.value.draft, reloaded.value.draft.payload, null);
  const edited = setPeriodCourse(draft, teachingDayPeriods(draft)[1].blockId, { kind: "new", name: "Biology" }, []);
  resumed.update(edited);
  await resumed.flush();
  const again = await a.repository.getState();
  check("a resumed session saves on top of the stored revision", again.ok && again.value.status === "in-progress" && again.value.draft.revision === 2 && deepEqual(again.value.draft.payload, edited));
  check("still no operational rows after resuming and editing", (await operationalRows(a.membershipId)) === 0);

  console.log("9. A failed save keeps the edit and recovers");
  const flaky = flakyRepository(a.repository);
  const stored = (await a.repository.getState()) as { ok: true; value: Extract<SetupState, { status: "in-progress" }> };
  const recovering = new SetupDraftSession(flaky, stored.value.draft, stored.value.draft.payload, null);
  flaky.failing = true;
  const offlineEdit = { ...edited, lunchWave: "B" as const };
  recovering.update(offlineEdit);
  await recovering.flush();
  const failed = recovering.getSnapshot();
  check("status is save-failed", failed.status.kind === "save-failed");
  check("the edit is kept on screen and still marked unsaved", failed.dirty && deepEqual(failed.draft, offlineEdit));
  const serverDuringOutage = await a.repository.getState();
  check("the server still holds the previous revision", serverDuringOutage.ok && serverDuringOutage.value.status === "in-progress" && serverDuringOutage.value.draft.revision === 2);
  flaky.failing = false;
  await recovering.retrySave();
  const afterRetry = await a.repository.getState();
  check("Retry saves the kept edit once", recovering.getSnapshot().status.kind === "saved" && afterRetry.ok && afterRetry.value.status === "in-progress" && afterRetry.value.draft.revision === 3 && deepEqual(afterRetry.value.draft.payload, offlineEdit));

  console.log("10. A stale tab cannot silently overwrite");
  const current = (await a.repository.getState()) as { ok: true; value: Extract<SetupState, { status: "in-progress" }> };
  const tabOne = new SetupDraftSession(a.repository, current.value.draft, current.value.draft.payload, null);
  const tabTwo = new SetupDraftSession(a.repository, current.value.draft, current.value.draft.payload, null);
  const fromTabOne = { ...offlineEdit, lunchWave: "C" as const };
  tabOne.update(fromTabOne);
  await tabOne.flush();
  const fromTabTwo = { ...offlineEdit, lunchWave: "A" as const };
  tabTwo.update(fromTabTwo);
  await tabTwo.flush();
  const stale = tabTwo.getSnapshot().status;
  check("the second tab gets a stale-revision conflict carrying the saved version", stale.kind === "conflict" && stale.reason === "stale-revision" && stale.serverDraft !== null && deepEqual(stale.serverDraft.payload, fromTabOne));
  const whileConflicted = await a.repository.getState();
  check("...and the saved version is untouched", whileConflicted.ok && whileConflicted.value.status === "in-progress" && deepEqual(whileConflicted.value.draft.payload, fromTabOne));
  tabTwo.update({ ...fromTabTwo, lunchWave: "B" });
  await tabTwo.flush();
  const stillPaused = await a.repository.getState();
  check("edits during the conflict are held, not saved", tabTwo.getSnapshot().status.kind === "conflict" && stillPaused.ok && stillPaused.value.status === "in-progress" && deepEqual(stillPaused.value.draft.payload, fromTabOne));
  await tabTwo.resolveConflict("use-server");
  check("\"Use the saved version\" replaces the screen with it", deepEqual(tabTwo.getSnapshot().draft, fromTabOne) && tabTwo.getSnapshot().status.kind === "saved");
  const tabThree = new SetupDraftSession(a.repository, current.value.draft, current.value.draft.payload, null);
  tabThree.update(fromTabTwo);
  await tabThree.flush();
  await tabThree.resolveConflict("keep-mine");
  const kept = await a.repository.getState();
  check("\"Keep what's on this screen\" saves it only after that choice", kept.ok && kept.value.status === "in-progress" && deepEqual(kept.value.draft.payload, fromTabTwo));

  console.log("11. Preferences changed elsewhere cannot be silently overwritten");
  const b = await newFounder("guided-b");
  const bState = (await b.repository.getState()) as { ok: true; value: Extract<SetupState, { status: "not-started" }> };
  const bSession = new SetupDraftSession(b.repository, null, createSetupDraftFromSeed(bState.value.seed, []), bState.value.seed);
  const ordinary = new SupabaseDataRepository(b.client as unknown as ConstructorParameters<typeof SupabaseDataRepository>[0], { organizationId: b.organizationId, membershipId: b.membershipId });
  const loaded: AppData = await ordinary.load();
  await ordinary.save({ ...loaded, teacherSchedulePreferences: { ...loaded.teacherSchedulePreferences, lunchWave: "C" } });
  bSession.update(ownDraftWithClass());
  await bSession.flush();
  const prefConflict = bSession.getSnapshot().status;
  check("the first save is refused as preferences-changed, reporting the current lunch wave", prefConflict.kind === "conflict" && prefConflict.reason === "preferences-changed" && prefConflict.preferences?.lunchWave === "C");
  check("...and no draft was created", ((await b.repository.getState()) as { value: SetupState }).value.status === "not-started");
  if (prefConflict.kind === "conflict" && prefConflict.preferences) {
    await bSession.adoptPreferences(adoptReportedPreferences(bSession.getSnapshot().draft, prefConflict.preferences, []));
  }
  const adoptedState = await b.repository.getState();
  check("\"Use these settings\" saves a draft that keeps the newer lunch wave", adoptedState.ok && adoptedState.value.status === "in-progress" && adoptedState.value.draft.payload.lunchWave === "C");
  check("the teacher's lunch wave set elsewhere is still C", (await db.admin<{ lunch_wave: string }>("select lunch_wave from public.teacher_schedule_preferences where owner_membership_id = $1", [b.membershipId]))[0]?.lunch_wave === "C");

  console.log("12. Established accounts bypass guided setup");
  const c = await newFounder("guided-c");
  const courseId = "course-ordinary";
  await db.asUser(c.userId, "insert into public.courses (id, organization_id, owner_type, owner_membership_id, name) values ($1, $2, 'teacher', $3, 'Algebra')", [courseId, c.organizationId, c.membershipId]);
  await db.asUser(c.userId, "insert into public.class_sections (id, organization_id, owner_membership_id, course_id, name) values ('section-ordinary', $1, $2, $3, 'Algebra - 1st Hour')", [c.organizationId, c.membershipId, courseId]);
  const cState = await c.repository.getState();
  const authority = deriveDataAuthorityState({
    state: "resolved",
    membership: { membershipId: c.membershipId, organizationId: c.organizationId, organizationName: "x", role: "admin", accountOrigin: "cloud_native", localDataMigratedAt: null },
  });
  check("an account with its own class is reported not eligible", cState.ok && cState.value.status === "not-started" && !cState.value.eligible);
  check("...so it keeps the existing flow even with the switch on", guidedSetupEntry(true, authority, cState.ok ? cState.value : null) === "existing-app");
  const dState = await (await newFounder("guided-d")).repository.getState();
  check("a brand-new account with the switch off keeps the existing flow", guidedSetupEntry(false, authority, dState.ok ? dState.value : null) === "existing-app");
  check("...and gets guided setup with it on", guidedSetupEntry(true, authority, dState.ok ? dState.value : null) === "guided-setup");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Source with comments removed, so a check is about code, not about what a comment explains. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function boundaryChecks() {
  console.log("13. Boundaries");
  const guidedFiles = [...walk(join(process.cwd(), "app/(guided)")), ...walk(join(process.cwd(), "components/guided"))].map((path) => ({ path, source: code(readFileSync(path, "utf8")) }));
  check("the guided route and components never mount or read the operational app state", guidedFiles.every(({ source }) => !/CutoverAppDataProvider|useAppData|AppDataProvider|NavBar/.test(source)));
  check("the guided components never use the operational save engine", guidedFiles.filter(({ path }) => path.includes("components")).every(({ source }) => !/SupabaseDataRepository|DataRepository|\.save\(/.test(source)));
  check("the switch is a server-only variable (no NEXT_PUBLIC_ copy anywhere)", !walk(join(process.cwd(), "lib")).concat(walk(join(process.cwd(), "app")), walk(join(process.cwd(), "components"))).some((path) => /NEXT_PUBLIC_FALCON_GUIDED_SETUP/.test(readFileSync(path, "utf8"))));
  const setupPage = readFileSync(join(process.cwd(), "app/(app)/setup/page.tsx"), "utf8");
  check("/setup sends only guided accounts to /start", /resolveGuidedSetupContext\(\)\)\.entry === "guided-setup"\) redirect\("\/start"\)/.test(setupPage));
}

async function main() {
  pureChecks();
  boundaryChecks();
  db = await createTestDatabase();
  try {
    await databaseChecks();
  } finally {
    await db.close();
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
