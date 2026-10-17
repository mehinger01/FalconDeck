/**
 * Browser harness for scripts/verify-guided-setup-interactions.ts: mounts the
 * real GuidedSetup component with an in-memory SetupRepository that follows
 * the setup RPCs' rules:
 *   save_setup_draft - revision compare-and-swap, draft-exists,
 *     draft-missing, stale-revision; answers "completed" once committed;
 *   complete_setup - replays a committed operation id; refuses a stale
 *     revision or another operation id; otherwise commits once, recording the
 *     operational rows it would create, and deletes the draft.
 * Bundled with esbuild and loaded into a Playwright Chromium page - no Next
 * server, no network, no database.
 *
 * window.__repo lets the test inspect saves and commits, write "from
 * another tab", make saves fail, make completion fail or lose its answer
 * after committing, or answer with a conflict.
 */
import { createRoot } from "react-dom/client";
import { GuidedSetup, type GuidedReference, type GuidedSetupProps } from "@/components/guided/GuidedSetup";
import type { SetupCompletion, SetupRepository, StoredSetupDraft } from "@/lib/onboarding/setupRepository";
import type { SetupDraft, SetupSeed } from "@/types/setupDraft";

type CompleteMode = "ok" | "fail-before-commit" | "reject-validation" | "reject-unexpected" | "lose-answer-after-commit" | "shared-schedule-changed" | "preferences-changed" | "no-longer-eligible";

interface HarnessRepo {
  stored: StoredSetupDraft | null;
  saves: Array<{ expectedRevision: number | null; payload: SetupDraft }>;
  /** Every complete_setup call, with what it answered. */
  completeCalls: Array<{ operationId: string; revision: number; answer: string }>;
  /** Committed operations - the operational rows each created (courses, classes, lesson...). */
  commits: Array<{ operationId: string; courses: number; classSections: number; lessons: number; payload: SetupDraft }>;
  completion: SetupCompletion | null;
  completeMode: CompleteMode;
  /** For "preferences-changed": what the server reports as current. */
  currentPreferences: SetupSeed;
  failing: boolean;
  delayMs: number;
  completeDelayMs: number;
  navigations: string[];
  /** What reloadReference() returns; null means "unchanged". */
  nextReference: GuidedReference | null;
  serverWrite(change: (payload: SetupDraft) => SetupDraft): void;
}

declare global {
  interface Window {
    __repo: HarnessRepo;
    __HARNESS: Pick<GuidedSetupProps, "setupState" | "schoolSchedules" | "schoolCourses" | "schoolCalendar">;
  }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const now = () => new Date().toISOString();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const repo: HarnessRepo = {
  stored: window.__HARNESS.setupState.status === "in-progress" ? clone(window.__HARNESS.setupState.draft) : null,
  saves: [],
  completeCalls: [],
  commits: [],
  completion: null,
  completeMode: "ok",
  currentPreferences: { activeBellScheduleId: null, lunchWave: "none" },
  failing: false,
  delayMs: 15,
  completeDelayMs: 150,
  navigations: [],
  nextReference: null,
  serverWrite(change) {
    if (!repo.stored) throw new Error("nothing stored");
    repo.stored = { ...repo.stored, revision: repo.stored.revision + 1, updatedAt: now(), payload: change(clone(repo.stored.payload)) };
  },
};
window.__repo = repo;

const repository: SetupRepository = {
  async getState() {
    return { ok: false, kind: "unknown", message: "not used by the harness" };
  },
  async saveDraft(expectedRevision, payload) {
    await wait(repo.delayMs);
    if (repo.failing) return { ok: false, kind: "unknown", message: "TypeError: Failed to fetch" };
    repo.saves.push({ expectedRevision, payload: clone(payload) });
    if (repo.completion) return { ok: true, value: { status: "completed", completion: repo.completion } };
    if (expectedRevision === null) {
      if (repo.stored) return { ok: true, value: { status: "conflict", reason: "draft-exists", draft: clone(repo.stored) } };
      repo.stored = { operationId: crypto.randomUUID(), revision: 1, updatedAt: now(), payload: clone(payload) };
    } else if (!repo.stored) {
      return { ok: true, value: { status: "conflict", reason: "draft-missing" } };
    } else if (repo.stored.revision !== expectedRevision) {
      return { ok: true, value: { status: "conflict", reason: "stale-revision", draft: clone(repo.stored) } };
    } else {
      repo.stored = { ...repo.stored, revision: repo.stored.revision + 1, updatedAt: now(), payload: clone(payload) };
    }
    const { operationId, revision, updatedAt } = repo.stored;
    return { ok: true, value: { status: "saved", operationId, revision, updatedAt } };
  },
  async completeSetup(operationId, revision) {
    await wait(repo.completeDelayMs);
    const record = (answer: string) => repo.completeCalls.push({ operationId, revision, answer });
    // Replay: a committed operation answers from its record and writes nothing.
    if (repo.completion) {
      if (repo.completion.operationId === operationId) {
        record("replayed");
        return { ok: true, value: { status: "completed", replayed: true, completion: repo.completion } };
      }
      record("already-completed");
      return { ok: true, value: { status: "conflict", reason: "already-completed", completion: repo.completion } };
    }
    if (repo.completeMode === "fail-before-commit") {
      record("unknown (nothing committed)");
      return { ok: false, kind: "unknown", message: "TypeError: Failed to fetch" };
    }
    // Refusals, as PostgREST reports them: the setup functions' own validation (22023), and a raw database error.
    if (repo.completeMode === "reject-validation") {
      record("rejected (validation)");
      return { ok: false, kind: "rejected", message: "Assign at least one class to a period.", code: "22023" };
    }
    if (repo.completeMode === "reject-unexpected") {
      record("rejected (unexpected)");
      return { ok: false, kind: "rejected", message: 'duplicate key value violates unique constraint "lessons_pkey"', code: "23505" };
    }
    if (!repo.stored) {
      record("draft-missing");
      return { ok: true, value: { status: "conflict", reason: "draft-missing" } };
    }
    if (repo.stored.operationId !== operationId) {
      record("operation-mismatch");
      return { ok: true, value: { status: "conflict", reason: "operation-mismatch", draft: clone(repo.stored) } };
    }
    if (repo.stored.revision !== revision) {
      record("stale-revision");
      return { ok: true, value: { status: "conflict", reason: "stale-revision", draft: clone(repo.stored) } };
    }
    if (repo.completeMode === "shared-schedule-changed") {
      record("shared-schedule-changed");
      repo.completeMode = "ok";
      return { ok: true, value: { status: "conflict", reason: "shared-schedule-changed" } };
    }
    if (repo.completeMode === "preferences-changed") {
      record("preferences-changed");
      repo.completeMode = "ok";
      return { ok: true, value: { status: "conflict", reason: "preferences-changed", preferences: clone(repo.currentPreferences) } };
    }
    if (repo.completeMode === "no-longer-eligible") {
      record("no-longer-eligible");
      return { ok: true, value: { status: "conflict", reason: "no-longer-eligible", ineligibility: "existing-setup" } };
    }
    // Commit once.
    const payload = clone(repo.stored.payload);
    repo.commits.push({ operationId, courses: payload.courses.length, classSections: payload.classSections.length, lessons: payload.firstLesson ? 1 : 0, payload });
    repo.completion = {
      operationId,
      completedAt: now(),
      scheduleMode: payload.schedule?.mode ?? "own",
      activeBellScheduleId: payload.schedule?.mode === "shared" ? payload.schedule.scheduleId : (payload.schedule?.id ?? ""),
      courseIds: payload.courses.map((c) => c.id),
      classSectionIds: payload.classSections.map((s) => s.id),
      lessonId: payload.firstLesson?.id ?? null,
    };
    repo.stored = null;
    if (repo.completeMode === "lose-answer-after-commit") {
      record("committed, answer lost");
      repo.completeMode = "ok";
      return { ok: false, kind: "unknown", message: "TypeError: Failed to fetch" };
    }
    record("committed");
    return { ok: true, value: { status: "completed", replayed: false, completion: repo.completion } };
  },
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <GuidedSetup
    organizationId="org-harness"
    organizationName="Harness School"
    repository={repository}
    onCompleted={() => {
      // Recorded at the moment the page would navigate: would the unsaved-work warning stop it?
      const leaving = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(leaving);
      repo.navigations.push(leaving.defaultPrevented ? "/present (blocked by the leave-page warning)" : "/present");
    }}
    reloadReference={async () => repo.nextReference}
    {...window.__HARNESS}
  />,
);
