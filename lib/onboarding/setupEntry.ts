import type { DataAuthorityState } from "@/lib/auth/dataAuthority";
import type { SetupState } from "./setupRepository";

/**
 * Which setup experience a signed-in request belongs in.
 *
 * "guided-setup" is a new-account entry point only. Everything else -
 * every legacy account, every account that already has classes or a
 * schedule of its own, every account whose setup state could not be read -
 * resolves to "existing-app", which means exactly today's behavior
 * (/setup, ActiveScheduleGate, MigrationSetupCard), unchanged.
 *
 * Setup done in the ordinary screens outranks an unfinished draft: the
 * server reports such an account as `not-started` and not eligible, never
 * `in-progress` (see get_setup_state), so it lands in "existing-app" here
 * rather than in a guided setup that could not be finished.
 */
export type SetupEntry = "guided-setup" | "existing-app";

/**
 * Pure, so it is testable without a request (see
 * scripts/verify-onboarding-setup-foundation.ts). `setupState` is null when
 * it was not or could not be fetched; that always fails toward the existing
 * app, never toward the new flow.
 *
 * A "local" authority (a legacy membership whose migration is still
 * pending) is decided here without consulting `setupState` at all: its
 * local browser data is still authoritative, so guided setup - which only
 * ever writes cloud data - must not be offered.
 */
export function deriveSetupEntry(authority: DataAuthorityState, setupState: SetupState | null): SetupEntry {
  if (authority.kind !== "cloud-ready" || setupState === null) return "existing-app";
  if (setupState.status === "in-progress") return "guided-setup";
  if (setupState.status === "not-started" && setupState.eligible) return "guided-setup";
  return "existing-app";
}
