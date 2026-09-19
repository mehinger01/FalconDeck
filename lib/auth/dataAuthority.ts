import type { ActiveOrganizationResolution } from "./dal";

/**
 * The one piece of auth/org state anything above the data-repository layer
 * needs - deliberately just plain, serializable identifiers, never a
 * Supabase client or session/JWT object. Mirrors resolveActiveOrganization's
 * own four states one-to-one (see lib/auth/dal.ts) - "needs-selection" is
 * kept distinct from "no-membership" even though Phase A's repository
 * selection treats them the same way, because they are semantically
 * different (memberships exist but none is chosen yet, vs. none exist at
 * all) and a future phase may need to tell them apart.
 */
export type DataAuthorityState =
  | { kind: "anonymous" }
  | { kind: "no-membership" }
  | { kind: "needs-selection" }
  | { kind: "local"; organizationId: string; membershipId: string; migratedAt: null }
  | { kind: "cloud-ready"; organizationId: string; membershipId: string; migratedAt: string };

/**
 * Pure derivation from resolveActiveOrganization's result - kept out of
 * lib/auth/dal.ts (which is "server-only") so it can be imported and
 * unit-tested from a plain script, or from a client component, without
 * pulling in next/headers or a Supabase client.
 */
export function deriveDataAuthorityState(resolution: ActiveOrganizationResolution): DataAuthorityState {
  switch (resolution.state) {
    case "unauthenticated":
      return { kind: "anonymous" };
    case "none":
      return { kind: "no-membership" };
    case "needs-selection":
      return { kind: "needs-selection" };
    case "resolved": {
      const { organizationId, membershipId, localDataMigratedAt } = resolution.membership;
      return localDataMigratedAt
        ? { kind: "cloud-ready", organizationId, membershipId, migratedAt: localDataMigratedAt }
        : { kind: "local", organizationId, membershipId, migratedAt: null };
    }
  }
}

/**
 * Stable identity for the *resolved data authority*, not just the
 * membership - used to force a fresh AppDataProvider mount (and therefore a
 * fresh hydration) any time what the app should treat as authoritative
 * changes: sign-in, sign-out, switching organizations, choosing between
 * memberships, or, in a future phase, migration completing. Deliberately
 * includes `kind` so a local -> cloud-ready transition for the same
 * membership id still produces a different key, per the "a changing
 * authority must force a remount, not a prop swap" requirement.
 */
export function dataAuthorityMountKey(state: DataAuthorityState): string {
  switch (state.kind) {
    case "anonymous":
      return "anonymous";
    case "no-membership":
      return "no-membership";
    case "needs-selection":
      return "needs-selection";
    case "local":
    case "cloud-ready":
      return `${state.kind}:${state.membershipId}`;
  }
}
