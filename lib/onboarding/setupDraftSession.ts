import { deepEqual } from "@/lib/data/supabaseMapping";
import type { SetupDraft, SetupSeed } from "@/types/setupDraft";
import type {
  SetupCompletion,
  SetupIneligibilityReason,
  SetupRepository,
  StoredSetupDraft,
} from "./setupRepository";

/**
 * Owns one tab's working copy of a setup draft: autosave, revision
 * tracking, visible failures, conflict handling, and completion. Plain
 * TypeScript - no React, no Supabase - so the setup UI is a thin
 * subscriber, and every rule here is testable without rendering
 * (scripts/verify-onboarding-setup-foundation.ts).
 *
 * Invariants:
 * - At most one request is in flight. Edits made meanwhile coalesce into
 *   one follow-up save of the latest draft (each save carries the whole
 *   draft, so skipped intermediates lose nothing).
 * - A save is only ever sent against the revision this tab last saw. If the
 *   server has moved on, nothing is overwritten: the session stops saving
 *   and reports a conflict until the caller chooses a side.
 * - A failed save is never silent and never dropped: the draft stays dirty
 *   and the status says so until a save succeeds.
 * - The operation id comes from the server-side draft and is never
 *   regenerated, so every completion attempt names the same operation.
 * - The first save of a new draft names the seed it was built from, and is
 *   refused if the stored preferences have moved on since (see
 *   adoptPreferences()).
 */

export type SetupConflictReason =
  | "draft-exists"
  | "stale-revision"
  | "draft-missing"
  | "operation-mismatch"
  | "shared-schedule-changed"
  | "preferences-changed";

export type SetupSessionStatus =
  /** Nothing unsaved, nothing in flight, nothing saved yet this session. */
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  /** The latest edits are NOT saved. Retried by retrySave() or the next edit. */
  | { kind: "save-failed"; message: string }
  /**
   * Autosave is paused. `serverDraft` is what is stored now, when there is
   * one. `preferences` is set only for "preferences-changed": the schedule
   * and lunch wave now in force.
   */
  | { kind: "conflict"; reason: SetupConflictReason; serverDraft: StoredSetupDraft | null; preferences?: SetupSeed }
  | { kind: "ineligible"; reason: SetupIneligibilityReason }
  | { kind: "completing" }
  /** The server refused; nothing was committed. */
  | { kind: "completion-rejected"; message: string }
  /** No answer arrived - setup may or may not have been committed. complete() again asks about the same operation. */
  | { kind: "completion-unconfirmed"; message: string }
  | { kind: "completed"; completion: SetupCompletion };

export interface SetupSessionSnapshot {
  draft: SetupDraft;
  status: SetupSessionStatus;
  /** True while the working draft differs from what the server is known to hold. */
  dirty: boolean;
}

const AUTOSAVE_BLOCKING_STATUSES: ReadonlyArray<SetupSessionStatus["kind"]> = [
  "conflict",
  "ineligible",
  "completing",
  "completed",
];

export class SetupDraftSession {
  private readonly repository: SetupRepository;
  /** The preferences the draft was built from - sent only with the save that creates it. */
  private seed: SetupSeed | null;
  private draft: SetupDraft;
  private operationId: string | null;
  private revision: number | null;
  private dirty = false;
  private status: SetupSessionStatus = { kind: "idle" };
  private saving: Promise<void> | null = null;
  /** The payload of a save whose outcome never arrived - see resolveOwnWrite(). */
  private unconfirmedPayload: SetupDraft | null = null;
  private readonly listeners = new Set<() => void>();

  /**
   * `stored` is the draft get_setup_state() returned (resume), or null for
   * a teacher starting fresh - in which case `initialDraft` is the working
   * copy and nothing is created server-side until the first edit.
   *
   * `seed` is get_setup_state()'s seed that `initialDraft` was built from.
   * It is required to create a draft (a fresh start), and unused when
   * resuming one - pass null then.
   */
  constructor(repository: SetupRepository, stored: StoredSetupDraft | null, initialDraft: SetupDraft, seed: SetupSeed | null) {
    this.repository = repository;
    this.seed = seed;
    this.draft = stored?.payload ?? initialDraft;
    this.operationId = stored?.operationId ?? null;
    this.revision = stored?.revision ?? null;
  }

  getSnapshot(): SetupSessionSnapshot {
    return { draft: this.draft, status: this.status, dirty: this.dirty };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replaces the working draft and schedules a save. */
  update(next: SetupDraft): void {
    if (this.status.kind === "completed") return;
    this.draft = next;
    this.dirty = true;
    this.notify();
    void this.pump();
  }

  /** Re-attempts a failed save. No-op in any other state. */
  retrySave(): Promise<void> {
    return this.status.kind === "save-failed" ? this.pump() : Promise.resolve();
  }

  /** Resolves once every edit so far is saved, or saving has stopped (failure/conflict). Makes one attempt - a failed save is not retried in a loop. */
  flush(): Promise<void> {
    return this.pump();
  }

  /**
   * Ends a conflict. "use-server" discards this tab's edits in favor of
   * what is stored. "keep-mine" re-sends this tab's draft on top of the
   * stored revision (or re-creates the draft if it no longer exists).
   *
   * "shared-schedule-changed" is not a disagreement between two copies of
   * the draft - the stored draft is this tab's own, pointing at periods
   * that have since changed. The caller rebuilds the schedule step via
   * update() (held while the conflict stands) and then calls "keep-mine".
   *
   * "preferences-changed" is the same shape: the stored draft is this tab's
   * own, but it would replace a schedule or lunch wave chosen elsewhere
   * since. The caller brings the draft into line with the `preferences`
   * reported (via update()) and then calls "keep-mine"; there is no way to
   * insist on the draft's older choice.
   */
  resolveConflict(choice: "use-server" | "keep-mine"): Promise<void> {
    if (this.status.kind !== "conflict") return Promise.resolve();
    const { serverDraft, reason } = this.status;
    if (serverDraft) {
      this.operationId = serverDraft.operationId;
      this.revision = serverDraft.revision;
    } else if (reason === "draft-missing") {
      this.operationId = null;
      this.revision = null;
    }
    this.unconfirmedPayload = null;
    if (choice === "use-server" && serverDraft) {
      this.draft = serverDraft.payload;
      this.dirty = false;
      this.setStatus({ kind: "saved" });
      return Promise.resolve();
    }
    this.dirty = true;
    this.setStatus({ kind: "idle" });
    return this.pump();
  }

  /**
   * Ends a "preferences-changed" conflict - from creating the draft or from
   * completing it - by adopting the schedule preferences now stored.
   * `rebuilt` is the caller's draft brought into line with them (for a fresh
   * start, typically createSetupDraftFromSeed() on the reported preferences
   * plus whatever the teacher had entered); it replaces the working draft
   * and is saved. The reported preferences become the seed a creation names,
   * so a draft built from the old seed cannot slip through - unless the
   * caller passes it back unchanged, which this cannot detect.
   */
  adoptPreferences(rebuilt: SetupDraft): Promise<void> {
    if (this.status.kind !== "conflict" || this.status.reason !== "preferences-changed" || !this.status.preferences) {
      return Promise.resolve();
    }
    this.seed = this.status.preferences;
    this.draft = rebuilt;
    this.dirty = true;
    this.unconfirmedPayload = null;
    this.setStatus({ kind: "idle" });
    return this.pump();
  }

  /**
   * Saves anything outstanding, then commits the stored draft. Always safe
   * to call again: the operation id is fixed, so a repeat after
   * "completion-unconfirmed" either learns the original committed or
   * performs it once.
   */
  async complete(): Promise<SetupSessionStatus> {
    if (this.status.kind === "completed" || this.status.kind === "completing") return this.status;

    await this.flush();
    // flush() may itself have discovered the answer (a save after a lost
    // completion response comes back "completed"), or stopped on a problem
    // the caller has to see first.
    // (Read through getSnapshot(): the compiler cannot see that flush()
    // changes this.status.)
    const afterFlush = this.getSnapshot().status;
    if (afterFlush.kind === "completed" || this.dirty || !this.canAutosave()) return afterFlush;
    if (this.operationId === null || this.revision === null) {
      this.setStatus({ kind: "completion-rejected", message: "There is nothing to finish yet." });
      return this.status;
    }

    this.setStatus({ kind: "completing" });
    const result = await this.repository.completeSetup(this.operationId, this.revision);

    if (!result.ok) {
      this.setStatus({
        kind: result.kind === "unknown" ? "completion-unconfirmed" : "completion-rejected",
        message: result.message,
      });
      return this.status;
    }

    const outcome = result.value;
    if (outcome.status === "completed") {
      this.setStatus({ kind: "completed", completion: outcome.completion });
    } else if (outcome.reason === "already-completed") {
      // This membership's setup was committed under another operation -
      // the committed result is the truth, not this draft.
      this.setStatus({ kind: "completed", completion: outcome.completion });
    } else if (outcome.reason === "no-longer-eligible") {
      // The account was set up in the ordinary screens meanwhile. There is
      // no side to choose: guided setup is over for it, same as when a
      // first save is refused.
      this.setStatus({ kind: "ineligible", reason: outcome.ineligibility });
    } else {
      this.setStatus({
        kind: "conflict",
        reason: outcome.reason,
        serverDraft: "draft" in outcome ? outcome.draft : null,
        ...(outcome.reason === "preferences-changed" ? { preferences: outcome.preferences } : {}),
      });
    }
    return this.status;
  }

  private canAutosave(): boolean {
    return !AUTOSAVE_BLOCKING_STATUSES.includes(this.status.kind);
  }

  private pump(): Promise<void> {
    if (!this.saving) {
      this.saving = this.runSaves().finally(() => {
        this.saving = null;
      });
    }
    return this.saving;
  }

  private async runSaves(): Promise<void> {
    while (this.dirty && this.canAutosave()) {
      const payload = this.draft;
      this.dirty = false;
      this.setStatus({ kind: "saving" });

      const result = await this.repository.saveDraft(this.revision, payload, this.revision === null ? this.seed : null);

      if (!result.ok) {
        this.dirty = true;
        if (result.kind === "unknown") this.unconfirmedPayload = payload;
        this.setStatus({ kind: "save-failed", message: result.message });
        return;
      }

      const outcome = result.value;
      if (outcome.status === "saved") {
        this.operationId = outcome.operationId;
        this.revision = outcome.revision;
        this.unconfirmedPayload = null;
        if (!this.dirty) this.setStatus({ kind: "saved" });
      } else if (outcome.status === "completed") {
        this.setStatus({ kind: "completed", completion: outcome.completion });
      } else if (outcome.status === "ineligible") {
        this.dirty = true;
        this.setStatus({ kind: "ineligible", reason: outcome.reason });
      } else if ("draft" in outcome && this.resolveOwnWrite(outcome.draft)) {
        // Loop again: either nothing is left to send, or a newer edit is.
        if (!this.dirty) this.setStatus({ kind: "saved" });
      } else {
        this.dirty = true;
        this.setStatus({
          kind: "conflict",
          reason: outcome.reason,
          serverDraft: "draft" in outcome ? outcome.draft : null,
          ...(outcome.reason === "preferences-changed" ? { preferences: outcome.preferences } : {}),
        });
      }
    }
  }

  /**
   * A save whose response was lost may in fact have been applied - in which
   * case the next save "conflicts" with this tab's own earlier write. That
   * is recognizable: the stored payload is exactly the one whose outcome
   * was never confirmed. Adopt its revision and carry on, rather than
   * showing the teacher a conflict with themselves.
   */
  private resolveOwnWrite(serverDraft: StoredSetupDraft): boolean {
    if (this.unconfirmedPayload === null || !deepEqual(serverDraft.payload, this.unconfirmedPayload)) return false;
    this.operationId = serverDraft.operationId;
    this.revision = serverDraft.revision;
    this.unconfirmedPayload = null;
    this.dirty = !deepEqual(this.draft, serverDraft.payload);
    return true;
  }

  private setStatus(status: SetupSessionStatus): void {
    this.status = status;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
