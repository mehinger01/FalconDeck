import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { deriveDataAuthorityState, type DataAuthorityState } from "./dataAuthority";

/**
 * Stores which of a multi-membership user's organizations is active for
 * this browser session. Only ever written by `selectOrganization` (lib/auth/actions.ts)
 * after re-validating the chosen id against that user's own active
 * memberships - never trusted blindly on read, see `resolveActiveOrganization`.
 */
export const ACTIVE_ORGANIZATION_COOKIE = "falcon-deck:active-organization-id";

export interface AuthenticatedClaims {
  userId: string;
  email?: string;
}

/**
 * The one place identity is verified. Uses `getClaims()`, not `getSession()`/
 * `getUser()` - per current Supabase guidance, `getClaims()` validates the
 * JWT signature every call, which is what makes it safe to gate pages/data
 * on. `cache()` memoizes this for the lifetime of one server render pass,
 * so calling it from a layout and a page in the same request costs one
 * validation, not two.
 */
export const getAuthenticatedClaims = cache(async (): Promise<AuthenticatedClaims | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { userId: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : undefined };
});

/** Redirects to /login rather than returning null - use from any route that requires a signed-in user regardless of organization membership (e.g. /onboarding, the (app) shell). */
export async function requireAuthenticatedUser(): Promise<AuthenticatedClaims> {
  const claims = await getAuthenticatedClaims();
  if (!claims) redirect("/login");
  return claims;
}

export type MembershipRole = "teacher" | "admin";

export interface ActiveMembership {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
  /** Null until this membership's one-time local-data migration has completed - see lib/data/migration/migrateLocalData.ts's markMigrationComplete. */
  localDataMigratedAt: string | null;
}

/**
 * Every row this returns is already scoped to the caller by RLS
 * (`organization_memberships_select_own_or_admin`: `user_id = auth.uid()`)
 * - the `.eq("user_id", ...)` filter here is defense-in-depth, not the
 * actual security boundary. Only `status = 'active'` memberships count:
 * a 'removed' or 'invited' row must never grant app access.
 */
export const getActiveMemberships = cache(async (userId: string): Promise<ActiveMembership[]> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("id, organization_id, role, local_data_migrated_at, organizations(name)")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error || !data) return [];

  return data.map((row) => {
    const organization = row.organizations as { name: string } | { name: string }[] | null;
    const organizationName = Array.isArray(organization) ? organization[0]?.name : organization?.name;
    return {
      membershipId: row.id as string,
      organizationId: row.organization_id as string,
      organizationName: organizationName ?? "Unknown school",
      role: row.role as MembershipRole,
      localDataMigratedAt: row.local_data_migrated_at as string | null,
    };
  });
});

export type ActiveOrganizationResolution =
  | { state: "unauthenticated" }
  | { state: "none" }
  | { state: "needs-selection"; memberships: ActiveMembership[] }
  | { state: "resolved"; membership: ActiveMembership };

/**
 * The single source of truth for "what organization, if any, is this
 * request acting as." Mirrors states A-D from the milestone spec:
 * unauthenticated / zero memberships / multiple unresolved / resolved.
 * A stored `ACTIVE_ORGANIZATION_COOKIE` value is only ever honored if it
 * still matches one of the user's *current* active memberships - it is
 * re-checked against a fresh query every time, never trusted as-is.
 */
export async function resolveActiveOrganization(): Promise<ActiveOrganizationResolution> {
  const claims = await getAuthenticatedClaims();
  if (!claims) return { state: "unauthenticated" };

  const memberships = await getActiveMemberships(claims.userId);
  if (memberships.length === 0) return { state: "none" };
  if (memberships.length === 1) return { state: "resolved", membership: memberships[0] };

  const cookieStore = await cookies();
  const selectedOrganizationId = cookieStore.get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  const match = selectedOrganizationId
    ? memberships.find((membership) => membership.organizationId === selectedOrganizationId)
    : undefined;

  return match ? { state: "resolved", membership: match } : { state: "needs-selection", memberships };
}

/** Where a request with this resolution should land once auth/org context is settled. */
export function destinationForResolution(resolution: ActiveOrganizationResolution): string {
  return resolution.state === "resolved" ? "/setup" : "/onboarding";
}

/**
 * The single entry point for "which DataRepository should this request's
 * app data come from" - see lib/store/CutoverAppDataProvider.tsx. Returns a
 * plain, serializable value (never a Supabase client or session) so it can
 * be passed straight from a Server Component into a "use client" provider.
 */
export async function resolveDataAuthorityState(): Promise<DataAuthorityState> {
  return deriveDataAuthorityState(await resolveActiveOrganization());
}
