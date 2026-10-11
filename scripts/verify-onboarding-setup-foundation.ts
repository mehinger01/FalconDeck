/**
 * Offline verification of guided setup's client-side foundation
 * (docs/ONBOARDING_SETUP_ARCHITECTURE.md): the pure draft logic, the
 * SetupDraftSession state machine against an in-memory SetupRepository,
 * response parsing, and the entry rule. No database, no network - the
 * database half lives in scripts/verify-onboarding-setup-db.ts.
 *
 *   npm run verify:onboarding-setup-foundation
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DataAuthorityState } from "@/lib/auth/dataAuthority";
import { createDemoAppData } from "@/lib/data/demoData";
import { deepEqual } from "@/lib/data/supabaseMapping";
import { SupabaseSetupRepository } from "@/lib/data/supabaseSetupRepository";
import {
  createEmptySetupDraft,
  hasSharedScheduleChanged,
  parseSetupDraft,
  projectSetupDraftToAppData,
  snapshotSharedBlocks,
  validateSetupDraft,
} from "@/lib/onboarding/setupDraft";
import { SetupDraftSession } from "@/lib/onboarding/setupDraftSession";
import { deriveSetupEntry } from "@/lib/onboarding/setupEntry";
import {
  parseCompleteSetupResult,
  parseSaveSetupDraftResult,
  parseSetupState,
  type CompleteSetupResult,
  type SaveSetupDraftResult,
  type SetupCallResult,
  type SetupCompletion,
  type SetupRepository,
  type SetupState,
} from "@/lib/onboarding/setupRepository";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

/** An in-memory SetupRepository with the same revision/operation semantics as the RPCs, plus hooks to hold or fail a call. */
class FakeSetupRepository implements SetupRepository {
  stored: { operationId: string; revision: number; payload: SetupDraft } | null = null;
  completion: SetupCompletion | null = null;
  saveCalls: SetupDraft[] = [];
  maxConcurrentSaves = 0;
  failNextSave: "rejected" | "unknown" | null = null;
  /** When set, saveDraft() waits on this before answering. */
  gate: Promise<void> | null = null;
  private activeSaves = 0;

  async getState(): Promise<SetupCallResult<SetupState>> {
    return { ok: true, value: { status: "not-started", eligible: true, reason: null } };
  }

  async saveDraft(expectedRevision: number | null, payload: SetupDraft): Promise<SetupCallResult<SaveSetupDraftResult>> {
    this.activeSaves += 1;
    this.maxConcurrentSaves = Math.max(this.maxConcurrentSaves, this.activeSaves);
    this.saveCalls.push(payload);
    try {
      if (this.gate) await this.gate;
      if (this.failNextSave) {
        const kind = this.failNextSave;
        this.failNextSave = null;
        return { ok: false, kind, message: "Network request failed." };
      }
      if (this.completion) return { ok: true, value: { status: "completed", completion: this.completion } };
      if (expectedRevision === null) {
        if (this.stored) return { ok: true, value: { status: "conflict", reason: "draft-exists", draft: { ...this.stored, updatedAt: "" } } };
        this.stored = { operationId: "op-1", revision: 1, payload };
      } else if (!this.stored) {
        return { ok: true, value: { status: "conflict", reason: "draft-missing" } };
      } else if (this.stored.revision !== expectedRevision) {
        return { ok: true, value: { status: "conflict", reason: "stale-revision", draft: { ...this.stored, updatedAt: "" } } };
      } else {
        this.stored = { ...this.stored, revision: this.stored.revision + 1, payload };
      }
      return { ok: true, value: { status: "saved", operationId: this.stored.operationId, revision: this.stored.revision, updatedAt: "" } };
    } finally {
      this.activeSaves -= 1;
    }
  }

  async completeSetup(operationId: string): Promise<SetupCallResult<CompleteSetupResult>> {
    const replayed = this.completion !== null;
    this.completion ??= {
      operationId,
      completedAt: "2026-10-10T00:00:00.000Z",
      scheduleMode: "own",
      activeBellScheduleId: "schedule-1",
      courseIds: [],
      classSectionIds: [],
      lessonId: null,
    };
    this.stored = null;
    return { ok: true, value: { status: "completed", replayed, completion: this.completion } };
  }
}

function draftWithWave(lunchWave: SetupDraft["lunchWave"]): SetupDraft {
  return { ...createEmptySetupDraft(), lunchWave };
}

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFilesUnder(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

async function main() {
  console.log("1. Autosave: one request at a time, latest edit wins, nothing skipped silently");
  {
    const repository = new FakeSetupRepository();
    let release: () => void = () => {};
    repository.gate = new Promise<void>((resolve) => (release = resolve));
    const session = new SetupDraftSession(repository, null, createEmptySetupDraft());
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.getSnapshot().status.kind));

    check("a new session is idle and clean", session.getSnapshot().status.kind === "idle" && !session.getSnapshot().dirty);
    session.update(draftWithWave("A"));
    session.update(draftWithWave("B"));
    session.update(draftWithWave("C"));
    check("edits made during a save are held as dirty", session.getSnapshot().dirty && session.getSnapshot().status.kind === "saving");
    repository.gate = null;
    release();
    await session.flush();

    check("three edits produced two saves, not three", repository.saveCalls.length === 2);
    check("the last save carried the latest edit", repository.saveCalls[1].lunchWave === "C" && repository.stored?.payload.lunchWave === "C");
    check("saves never overlapped", repository.maxConcurrentSaves === 1);
    check("the session ends saved and clean", session.getSnapshot().status.kind === "saved" && !session.getSnapshot().dirty);
    check("subscribers saw saving before saved", seen.includes("saving") && seen[seen.length - 1] === "saved");
  }

  console.log("\n2. A failed save is visible, keeps the edit, and recovers");
  {
    const repository = new FakeSetupRepository();
    const session = new SetupDraftSession(repository, null, createEmptySetupDraft());
    repository.failNextSave = "rejected";
    session.update(draftWithWave("A"));
    await session.flush();
    const failed = session.getSnapshot();
    check("status is save-failed with the server's message", failed.status.kind === "save-failed" && failed.status.message === "Network request failed.");
    check("the edit is still held and still dirty", failed.dirty && failed.draft.lunchWave === "A" && repository.stored === null);
    check("flush() does not retry in a loop", repository.saveCalls.length === 1);

    const refused = await session.complete();
    check("complete() retries the save first", repository.saveCalls.length === 2);
    check("...and, once saved, completes", refused.kind === "completed");

    const second = new FakeSetupRepository();
    const retrying = new SetupDraftSession(second, null, createEmptySetupDraft());
    second.failNextSave = "rejected";
    retrying.update(draftWithWave("B"));
    await retrying.flush();
    second.failNextSave = "rejected";
    check("complete() does not proceed past a save that keeps failing", (await retrying.complete()).kind === "save-failed" && second.completion === null);
    await retrying.retrySave();
    check("retrySave() saves the held edit", retrying.getSnapshot().status.kind === "saved" && second.stored?.payload.lunchWave === "B");
  }

  console.log("\n3. Conflicts pause autosave until a side is chosen");
  {
    const repository = new FakeSetupRepository();
    const first = new SetupDraftSession(repository, null, createEmptySetupDraft());
    first.update(draftWithWave("A"));
    await first.flush();

    // A second tab that never saw the first tab's draft.
    const second = new SetupDraftSession(repository, null, createEmptySetupDraft());
    second.update(draftWithWave("B"));
    await second.flush();
    const status = second.getSnapshot().status;
    check("creating a draft that already exists is a draft-exists conflict", status.kind === "conflict" && status.reason === "draft-exists");
    const callsAtConflict = repository.saveCalls.length;
    second.update(draftWithWave("C"));
    await second.flush();
    check("further edits are held, not sent, while the conflict stands", repository.saveCalls.length === callsAtConflict && second.getSnapshot().draft.lunchWave === "C");
    check("the stored draft is untouched", repository.stored?.payload.lunchWave === "A");

    await second.resolveConflict("keep-mine");
    check("'keep-mine' saves this tab's draft on top of the stored revision", repository.stored?.payload.lunchWave === "C" && repository.stored.revision === 2);
    check("...and resumes normal saving", second.getSnapshot().status.kind === "saved");

    const completedElsewhere = new SetupDraftSession(repository, { operationId: "op-1", revision: 2, updatedAt: "", payload: draftWithWave("C") }, createEmptySetupDraft());
    await second.complete();
    completedElsewhere.update(draftWithWave("none"));
    await completedElsewhere.flush();
    check("a tab that autosaves after another tab completed learns it is completed", completedElsewhere.getSnapshot().status.kind === "completed");
    completedElsewhere.update(draftWithWave("A"));
    check("...and accepts no further edits", completedElsewhere.getSnapshot().draft.lunchWave === "none");
  }

  console.log("\n4. An ineligible account never gets a draft");
  {
    const repository = new FakeSetupRepository();
    repository.saveDraft = async () => ({ ok: true, value: { status: "ineligible", reason: "existing-setup" } });
    const session = new SetupDraftSession(repository, null, createEmptySetupDraft());
    session.update(draftWithWave("A"));
    await session.flush();
    const status = session.getSnapshot().status;
    check("the session reports ineligible with the reason", status.kind === "ineligible" && status.reason === "existing-setup");
    check("complete() does not run", (await session.complete()).kind === "ineligible" && repository.completion === null);
  }

  console.log("\n5. Transport failures are 'unknown'; server refusals are 'rejected'");
  {
    const respond = (response: { data: unknown; error: { message: string; code?: string } | null } | Error) =>
      new SupabaseSetupRepository(
        { rpc: async () => { if (response instanceof Error) throw response; return response; } },
        "org-1",
      ).getState();
    const thrown = await respond(new Error("socket hang up"));
    check("a thrown request is unknown", !thrown.ok && thrown.kind === "unknown");
    const fetchFailed = await respond({ data: null, error: { message: "TypeError: Failed to fetch", code: "" } });
    check("an error with no code is unknown", !fetchFailed.ok && fetchFailed.kind === "unknown");
    const raised = await respond({ data: null, error: { message: "Authentication required.", code: "28000" } });
    check("an error with a SQLSTATE is rejected, message preserved", !raised.ok && raised.kind === "rejected" && raised.message === "Authentication required.");
    const garbage = await respond({ data: { status: "something-new" }, error: null });
    check("an unrecognized success body is unknown, never trusted", !garbage.ok && garbage.kind === "unknown");

    let sent: Record<string, unknown> = {};
    await new SupabaseSetupRepository({ rpc: async (_name, args) => { sent = args; return { data: null, error: null }; } }, "org-1").completeSetup("op-9", 4);
    check("only the organization id, operation id and revision are sent to complete_setup", deepEqual(sent, { p_organization_id: "org-1", p_operation_id: "op-9", p_expected_revision: 4 }));
  }

  console.log("\n6. Response and payload parsing");
  {
    const completion = { operationId: "op", completedAt: "t", scheduleMode: "own", activeBellScheduleId: "s", courseIds: [], classSectionIds: ["a"], lessonId: null };
    const draft = { operationId: "op", revision: 3, updatedAt: "t", payload: createEmptySetupDraft() };
    check("completed state parses", parseSetupState({ status: "completed", completion })?.status === "completed");
    check("in-progress state parses", parseSetupState({ status: "in-progress", draft })?.status === "in-progress");
    check("a draft from another version is refused", parseSetupState({ status: "in-progress", draft: { ...draft, payload: { ...draft.payload, version: 2 } } }) === null);
    check("a completion missing a field is refused", parseSetupState({ status: "completed", completion: { ...completion, activeBellScheduleId: undefined } }) === null);
    check("saved parses to a flat result", deepEqual(parseSaveSetupDraftResult({ status: "saved", draft: { operationId: "op", revision: 1, updatedAt: "t" } }), { status: "saved", operationId: "op", revision: 1, updatedAt: "t" }));
    check("a stale-revision conflict without its draft is refused", parseSaveSetupDraftResult({ status: "conflict", reason: "stale-revision" }) === null);
    check("draft-missing needs no draft", parseSaveSetupDraftResult({ status: "conflict", reason: "draft-missing" })?.status === "conflict");
    check("shared-schedule-changed parses", parseCompleteSetupResult({ status: "conflict", reason: "shared-schedule-changed" })?.status === "conflict");
    check("completed without 'replayed' is refused", parseCompleteSetupResult({ status: "completed", completion }) === null);
    check("parseSetupDraft refuses non-objects and wrong versions", parseSetupDraft(null) === null && parseSetupDraft("x") === null && parseSetupDraft({ version: 1 }) === null);
    check("parseSetupDraft round-trips an empty draft", deepEqual(parseSetupDraft(JSON.parse(JSON.stringify(createEmptySetupDraft()))), createEmptySetupDraft()));
  }

  console.log("\n7. Validation and projection");
  {
    const base = createDemoAppData();
    const shared: BellSchedule = {
      id: "schedule-shared",
      name: "Regular Day",
      ownerType: "organization",
      isDefault: true,
      timeZone: "America/Detroit",
      blocks: [
        { id: "p1", label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: null, overrides: [] },
        { id: "p2", label: "2nd Hour", kind: "instructional", startTime: "08:55", endTime: "09:45", classSectionId: null, overrides: [] },
      ],
    };
    const reference = { ...base, schedules: [...base.schedules, shared] };
    const frozen = JSON.stringify(reference);

    const empty = validateSetupDraft(createEmptySetupDraft(), reference);
    check("an empty draft reports missing classes, schedule and lesson", ["Add at least one class.", "Choose a schedule.", "Plan a first lesson for one of your classes."].every((message) => empty.some((issue) => issue.message === message)));
    check("issues name the step to return to", empty.some((issue) => issue.step === "teaching-day") && empty.some((issue) => issue.step === "first-lesson"));

    const draft: SetupDraft = {
      ...createEmptySetupDraft(),
      courses: [{ id: "course-new", name: "  Geometry " }],
      classSections: [{ id: "section-new", courseId: "course-new", name: "Geometry - 1st" }],
      schedule: {
        mode: "shared",
        scheduleId: shared.id,
        expectedBlocks: snapshotSharedBlocks(shared),
        assignments: [{ id: "3f2c1e9a-1c2b-4d3e-8f4a-5b6c7d8e9f01", blockId: "p2", classSectionId: "section-new" }],
      },
      lunchWave: "B",
      firstLesson: { id: "lesson-new", date: "2026-10-12", classSectionId: "section-new", learningTarget: "I can.", agendaItems: [], resources: [], announcements: [] },
    };
    check("a complete shared-schedule draft has no issues", validateSetupDraft(draft, reference).length === 0);
    check("a lesson with no content is not 'prepared'", validateSetupDraft({ ...draft, firstLesson: { ...draft.firstLesson!, learningTarget: " " } }, reference).some((issue) => issue.step === "first-lesson"));

    const moved = { ...shared, blocks: shared.blocks.map((block) => (block.id === "p1" ? { ...block, startTime: "08:05" } : block)) };
    check("an unchanged shared schedule is not flagged", draft.schedule?.mode === "shared" && !hasSharedScheduleChanged(draft.schedule, reference.schedules));
    check("a moved period is flagged", draft.schedule?.mode === "shared" && hasSharedScheduleChanged(draft.schedule, [moved]));
    check("a deleted shared schedule is flagged", draft.schedule?.mode === "shared" && hasSharedScheduleChanged(draft.schedule, []));
    check("a schedule that became 'needs configuration' is flagged", draft.schedule?.mode === "shared" && hasSharedScheduleChanged(draft.schedule, [{ ...shared, needsConfiguration: true }]));

    const own: SetupDraft = {
      ...draft,
      schedule: {
        mode: "own",
        id: "schedule-own",
        name: "Mine",
        timeZone: "America/Detroit",
        blocks: [
          { id: "b2", label: "Second", kind: "instructional", startTime: "08:30", endTime: "09:30", classSectionId: null },
          { id: "b1", label: "First", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: "section-new" },
        ],
      },
    };
    const ownIssues = validateSetupDraft(own, reference);
    check("overlapping periods are reported once, by the existing schedule validator", ownIssues.filter((issue) => issue.message === '"First" overlaps with "Second".').length === 1);

    const projected = projectSetupDraftToAppData(draft, reference, "2026-10-10T00:00:00.000Z");
    check("projection never mutates its base", JSON.stringify(reference) === frozen);
    check("projection keeps every existing course and adds the new one, trimmed", projected.courses.length === reference.courses.length + 1 && projected.courses.some((course) => course.id === "course-new" && course.name === "Geometry"));
    check("projection activates the shared schedule and sets the lunch wave", deepEqual(projected.teacherSchedulePreferences, { lunchWave: "B", activeBellScheduleId: shared.id }));
    const projectedShared = projected.schedules.find((schedule) => schedule.id === shared.id);
    check("projection shows the class in the assigned period only", projectedShared?.blocks[1].classSectionId === "section-new" && projectedShared.blocks[0].classSectionId === null);
    check("projection adds a base teacher period assignment", projected.teacherPeriodAssignments.some((assignment) => assignment.blockId === "p2" && assignment.overrideWeekday === null && assignment.scheduleId === shared.id));
    check("projection leaves every other schedule as the same object", reference.schedules.every((schedule) => schedule.id === shared.id || projected.schedules.includes(schedule)));

    const projectedOwn = projectSetupDraftToAppData(own, reference, "");
    const ownSchedule = projectedOwn.schedules.find((schedule) => schedule.id === "schedule-own");
    check("an own schedule projects as teacher-owned, chronological, and active", ownSchedule?.ownerType === "teacher" && ownSchedule.blocks.map((block) => block.id).join() === "b1,b2" && projectedOwn.teacherSchedulePreferences.activeBellScheduleId === "schedule-own");
  }

  console.log("\n8. Entry rule: only an eligible or resuming cloud account enters guided setup");
  {
    const ids = { organizationId: "org", membershipId: "mem" };
    const cloud: DataAuthorityState = { kind: "cloud-ready", ...ids, migratedAt: null };
    const eligible: SetupState = { status: "not-started", eligible: true, reason: null };
    const inProgress: SetupState = { status: "in-progress", draft: { operationId: "op", revision: 1, updatedAt: "", payload: createEmptySetupDraft() } };
    const completed: SetupState = { status: "completed", completion: { operationId: "op", completedAt: "", scheduleMode: "own", activeBellScheduleId: "s", courseIds: [], classSectionIds: [], lessonId: null } };

    check("cloud + eligible -> guided setup", deriveSetupEntry(cloud, eligible) === "guided-setup");
    check("cloud + draft in progress -> guided setup (resume)", deriveSetupEntry(cloud, inProgress) === "guided-setup");
    check("cloud + completed -> existing app", deriveSetupEntry(cloud, completed) === "existing-app");
    check("cloud + existing setup -> existing app", deriveSetupEntry(cloud, { status: "not-started", eligible: false, reason: "existing-setup" }) === "existing-app");
    check("cloud + state unavailable -> existing app", deriveSetupEntry(cloud, null) === "existing-app");
    check("legacy migration pending -> existing app, whatever the state says", deriveSetupEntry({ kind: "local", ...ids, migratedAt: null }, eligible) === "existing-app");
    for (const kind of ["anonymous", "no-membership", "needs-selection"] as const) {
      check(`${kind} -> existing app`, deriveSetupEntry({ kind }, eligible) === "existing-app");
    }
  }

  console.log("\n9. Boundaries");
  {
    const root = process.cwd();
    const read = (path: string) => readFileSync(join(root, path), "utf8");
    const componentFiles = sourceFilesUnder(join(root, "components"));
    check("no component imports a @supabase package", componentFiles.every((file) => !/@supabase\//.test(readFileSync(file, "utf8"))));
    // MigrationSetupCard predates this work and is the one known component
    // that constructs a browser client itself (see docs/CURRENT_STATE.md).
    // This pins the list so guided setup's UI cannot quietly add to it.
    const clientFactoryImporters = componentFiles.filter((file) => /lib\/supabase\//.test(readFileSync(file, "utf8")));
    check("no component other than MigrationSetupCard imports a Supabase client factory", clientFactoryImporters.every((file) => file.endsWith("MigrationSetupCard.tsx")));
    const onboardingFiles = sourceFilesUnder(join(root, "lib/onboarding"));
    check("nothing under lib/onboarding imports a Supabase client", onboardingFiles.every((file) => !/@supabase\/|lib\/supabase\//.test(readFileSync(file, "utf8"))));
    check("the setup repository never touches a DataRepository or the reducer", !/DataRepository|lib\/store|applyDiff/.test(read("lib/data/supabaseSetupRepository.ts").replace(/\/\*[\s\S]*?\*\//g, "")));

    const untouched = ["lib/data/supabaseDataRepository.ts", "lib/store/AppDataProvider.tsx", "lib/store/CutoverAppDataProvider.tsx", "lib/store/selectDataRepository.ts", "lib/auth/dal.ts", "lib/auth/dataAuthority.ts", "lib/data/types.ts"];
    check("the general save engine, provider, and authority code do not reference setup drafts", untouched.every((path) => !/setup_drafts|setupDraft|SetupRepository|complete_setup/.test(read(path))));

    const rpcs = read("supabase/migrations/20261010210100_onboarding_setup_stage_b_rpcs.sql");
    const code = rpcs.replace(/--.*$/gm, "");
    check("complete_setup never inserts an organization-owned row", !/'organization'\s*,\s*(null|v_membership_id)/.test(code.slice(code.indexOf("insert into public.courses"))));
    check("complete_setup has no UPDATE or DELETE on a schedule table", !/(update|delete from)\s+public\.(bell_schedules|schedule_blocks|schedule_block_overrides)/.test(code));
    check("every function pins search_path", (code.match(/create function/g) ?? []).length === (code.match(/set search_path = pg_catalog/g) ?? []).length);
    check("no function takes a membership or user id from the caller", !/p_(membership|user|owner)_id/.test(code.replace(/setup_ineligibility_reason\(p_membership_id uuid\)[\s\S]*?\$\$;/, "")));
    for (const fn of ["get_setup_state(uuid)", "save_setup_draft(uuid, integer, jsonb)", "complete_setup(uuid, uuid, integer)"]) {
      const quoted = fn.replace(/[()]/g, "\\$&");
      check(`${fn}: revoked from public and anon, granted to authenticated`,
        new RegExp(`revoke execute on function public\\.${quoted} from public;`).test(code) &&
        new RegExp(`revoke execute on function public\\.${quoted} from anon;`).test(code) &&
        new RegExp(`grant execute on function public\\.${quoted} to authenticated;`).test(code));
    }
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
