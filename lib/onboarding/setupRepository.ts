import type { SetupDraft, SetupSeed } from "@/types/setupDraft";
import { parseSetupDraft } from "./setupDraft";

/**
 * The persistence seam for guided setup - the counterpart of DataRepository
 * for the one thing DataRepository deliberately does not carry: an
 * uncommitted setup draft and its atomic completion. UI and
 * SetupDraftSession depend only on this interface, never on a Supabase
 * client (see lib/data/supabaseSetupRepository.ts for the implementation).
 */

export interface SetupCompletion {
  operationId: string;
  completedAt: string;
  scheduleMode: "shared" | "own";
  activeBellScheduleId: string;
  courseIds: string[];
  classSectionIds: string[];
  lessonId: string | null;
}

export interface StoredSetupDraft {
  operationId: string;
  revision: number;
  updatedAt: string;
  payload: SetupDraft;
}

export type SetupIneligibilityReason = "migration-pending" | "legacy-account" | "existing-setup";

export type SetupState =
  | { status: "completed"; completion: SetupCompletion }
  | { status: "in-progress"; draft: StoredSetupDraft }
  | { status: "not-started"; eligible: boolean; reason: SetupIneligibilityReason | null; seed: SetupSeed };

export type SaveSetupDraftResult =
  | { status: "saved"; operationId: string; revision: number; updatedAt: string }
  | { status: "conflict"; reason: "draft-exists" | "stale-revision"; draft: StoredSetupDraft }
  | { status: "conflict"; reason: "draft-missing" }
  | { status: "completed"; completion: SetupCompletion }
  | { status: "ineligible"; reason: SetupIneligibilityReason };

export type CompleteSetupResult =
  | { status: "completed"; replayed: boolean; completion: SetupCompletion }
  | { status: "conflict"; reason: "stale-revision" | "operation-mismatch"; draft: StoredSetupDraft }
  | { status: "conflict"; reason: "shared-schedule-changed" | "draft-missing" }
  | { status: "conflict"; reason: "already-completed"; completion: SetupCompletion }
  /** The account was set up through the ordinary screens after this draft was started. Nothing was written. */
  | { status: "conflict"; reason: "no-longer-eligible"; ineligibility: SetupIneligibilityReason };

/**
 * `rejected`: the server answered and refused - nothing was applied.
 * `unknown`: no usable answer arrived (network failure, timeout, unreadable
 * response) - a write MAY have been applied. Callers must treat these
 * differently: `unknown` after completeSetup() means "retry the same
 * operation", never "start over".
 */
export type SetupCallResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "rejected" | "unknown"; message: string };

export interface SetupRepository {
  getState(): Promise<SetupCallResult<SetupState>>;
  /** `expectedRevision: null` creates the draft; otherwise the save applies only if the stored draft is still at that revision. */
  saveDraft(expectedRevision: number | null, payload: SetupDraft): Promise<SetupCallResult<SaveSetupDraftResult>>;
  /** Commits the STORED draft. Safe to repeat with the same operationId any number of times. */
  completeSetup(operationId: string, expectedRevision: number): Promise<SetupCallResult<CompleteSetupResult>>;
}

// ---------------------------------------------------------------------------
// Response parsing - every RPC result is `unknown` until proven otherwise.
// Returning null means "not a response this build understands".
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseCompletion(value: unknown): SetupCompletion | null {
  if (!isRecord(value)) return null;
  const { operationId, completedAt, scheduleMode, activeBellScheduleId, courseIds, classSectionIds, lessonId } = value;
  if (
    typeof operationId !== "string" ||
    typeof completedAt !== "string" ||
    (scheduleMode !== "shared" && scheduleMode !== "own") ||
    typeof activeBellScheduleId !== "string" ||
    !isStringArray(courseIds) ||
    !isStringArray(classSectionIds) ||
    (lessonId !== null && typeof lessonId !== "string")
  ) {
    return null;
  }
  return { operationId, completedAt, scheduleMode, activeBellScheduleId, courseIds, classSectionIds, lessonId };
}

function parseDraftMeta(value: unknown): Omit<StoredSetupDraft, "payload"> | null {
  if (!isRecord(value)) return null;
  const { operationId, revision, updatedAt } = value;
  if (typeof operationId !== "string" || typeof revision !== "number" || typeof updatedAt !== "string") return null;
  return { operationId, revision, updatedAt };
}

function parseStoredDraft(value: unknown): StoredSetupDraft | null {
  const meta = parseDraftMeta(value);
  const payload = isRecord(value) ? parseSetupDraft(value.payload) : null;
  return meta && payload ? { ...meta, payload } : null;
}

const INELIGIBILITY_REASONS: readonly string[] = ["migration-pending", "legacy-account", "existing-setup"];

function parseIneligibilityReason(value: unknown): SetupIneligibilityReason | null {
  return typeof value === "string" && INELIGIBILITY_REASONS.includes(value) ? (value as SetupIneligibilityReason) : null;
}

const LUNCH_WAVES: readonly string[] = ["A", "B", "C", "none"];

function parseSeed(value: unknown): SetupSeed | null {
  if (!isRecord(value)) return null;
  const { activeBellScheduleId, lunchWave } = value;
  if (activeBellScheduleId !== null && typeof activeBellScheduleId !== "string") return null;
  if (typeof lunchWave !== "string" || !LUNCH_WAVES.includes(lunchWave)) return null;
  return { activeBellScheduleId, lunchWave: lunchWave as SetupSeed["lunchWave"] };
}

export function parseSetupState(value: unknown): SetupState | null {
  if (!isRecord(value)) return null;
  if (value.status === "completed") {
    const completion = parseCompletion(value.completion);
    return completion && { status: "completed", completion };
  }
  if (value.status === "in-progress") {
    const draft = parseStoredDraft(value.draft);
    return draft && { status: "in-progress", draft };
  }
  if (value.status === "not-started" && typeof value.eligible === "boolean") {
    const seed = parseSeed(value.seed);
    return seed && { status: "not-started", eligible: value.eligible, reason: parseIneligibilityReason(value.reason), seed };
  }
  return null;
}

export function parseSaveSetupDraftResult(value: unknown): SaveSetupDraftResult | null {
  if (!isRecord(value)) return null;
  if (value.status === "saved") {
    const meta = parseDraftMeta(value.draft);
    return meta && { status: "saved", ...meta };
  }
  if (value.status === "completed") {
    const completion = parseCompletion(value.completion);
    return completion && { status: "completed", completion };
  }
  if (value.status === "ineligible") {
    const reason = parseIneligibilityReason(value.reason);
    return reason && { status: "ineligible", reason };
  }
  if (value.status === "conflict") {
    if (value.reason === "draft-missing") return { status: "conflict", reason: "draft-missing" };
    if (value.reason === "draft-exists" || value.reason === "stale-revision") {
      const draft = parseStoredDraft(value.draft);
      return draft && { status: "conflict", reason: value.reason, draft };
    }
  }
  return null;
}

export function parseCompleteSetupResult(value: unknown): CompleteSetupResult | null {
  if (!isRecord(value)) return null;
  if (value.status === "completed" && typeof value.replayed === "boolean") {
    const completion = parseCompletion(value.completion);
    return completion && { status: "completed", replayed: value.replayed, completion };
  }
  if (value.status === "conflict") {
    if (value.reason === "shared-schedule-changed" || value.reason === "draft-missing") {
      return { status: "conflict", reason: value.reason };
    }
    if (value.reason === "stale-revision" || value.reason === "operation-mismatch") {
      const draft = parseStoredDraft(value.draft);
      return draft && { status: "conflict", reason: value.reason, draft };
    }
    if (value.reason === "already-completed") {
      const completion = parseCompletion(value.completion);
      return completion && { status: "conflict", reason: "already-completed", completion };
    }
    if (value.reason === "no-longer-eligible") {
      const ineligibility = parseIneligibilityReason(value.ineligibility);
      return ineligibility && { status: "conflict", reason: "no-longer-eligible", ineligibility };
    }
  }
  return null;
}
