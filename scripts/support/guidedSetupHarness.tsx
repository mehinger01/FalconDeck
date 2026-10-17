/**
 * Browser harness for scripts/verify-guided-setup-interactions.ts: mounts the
 * real GuidedSetup component with an in-memory SetupRepository that follows
 * save_setup_draft's rules (revision compare-and-swap, draft-exists,
 * draft-missing, stale-revision). Bundled with esbuild and loaded into a
 * Playwright Chromium page - no Next server, no network, no database.
 *
 * window.__repo lets the test inspect every save, write "from another tab",
 * and make saves fail.
 */
import { createRoot } from "react-dom/client";
import { GuidedSetup, type GuidedSetupProps } from "@/components/guided/GuidedSetup";
import type { SetupCallResult, SetupRepository, StoredSetupDraft } from "@/lib/onboarding/setupRepository";
import type { SetupDraft } from "@/types/setupDraft";

interface HarnessRepo {
  stored: StoredSetupDraft | null;
  saves: Array<{ expectedRevision: number | null; payload: SetupDraft }>;
  completeCalls: number;
  failing: boolean;
  /** How long each save takes to answer, in ms. */
  delayMs: number;
  /** Simulates another tab saving on top of the stored draft. */
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

const repo: HarnessRepo = {
  stored: window.__HARNESS.setupState.status === "in-progress" ? clone(window.__HARNESS.setupState.draft) : null,
  saves: [],
  completeCalls: 0,
  failing: false,
  delayMs: 15,
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
  async saveDraft(expectedRevision, payload): Promise<SetupCallResult<never>> {
    await new Promise((resolve) => setTimeout(resolve, repo.delayMs));
    if (repo.failing) return { ok: false, kind: "unknown", message: "TypeError: Failed to fetch" };
    repo.saves.push({ expectedRevision, payload: clone(payload) });
    if (expectedRevision === null) {
      if (repo.stored) return { ok: true, value: { status: "conflict", reason: "draft-exists", draft: clone(repo.stored) } } as never;
      repo.stored = { operationId: crypto.randomUUID(), revision: 1, updatedAt: now(), payload: clone(payload) };
    } else if (!repo.stored) {
      return { ok: true, value: { status: "conflict", reason: "draft-missing" } } as never;
    } else if (repo.stored.revision !== expectedRevision) {
      return { ok: true, value: { status: "conflict", reason: "stale-revision", draft: clone(repo.stored) } } as never;
    } else {
      repo.stored = { ...repo.stored, revision: repo.stored.revision + 1, updatedAt: now(), payload: clone(payload) };
    }
    const { operationId, revision, updatedAt } = repo.stored;
    return { ok: true, value: { status: "saved", operationId, revision, updatedAt } } as never;
  },
  async completeSetup() {
    repo.completeCalls += 1;
    return { ok: false, kind: "rejected", message: "complete_setup must not be called in this stage" };
  },
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <GuidedSetup organizationId="org-harness" organizationName="Harness School" repository={repository} {...window.__HARNESS} />,
);
