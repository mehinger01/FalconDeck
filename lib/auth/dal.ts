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

/**
 * Whether this membership has a legacy-migration concept at all -
 * see lib/auth/dataAuthority.ts's doc comment for the full state model.
 * 'cloud_native': no local data was ever authoritative for this
 * membership; always cloud-ready regardless of localDataMigratedAt.
 * 'legacy_import': has (or had) real local browser data to migrate;
 * localDataMigratedAt alone decides whether that migration is still
 * pending or already complete.
 */
export type AccountOrigin = "cloud_native" | "legacy_import";

export interface ActiveMembership {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
  accountOrigin: AccountOrigin;
  /** Null until this membership's one-time local-data migration has completed - see lib/data/migration/migrateLocalData.ts's markMigrationComplete. Only meaningful when accountOrigin is 'legacy_import'; never fabricated for 'cloud_native'. */
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
    .select("id, organization_id, role, account_origin, local_data_migrated_at, organizations(name)")
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
      accountOrigin: row.account_origin as AccountOrigin,
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

export interface SchoolSearchResult {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

/** A search term shorter than this never queries organizations at all - avoids a full-table scan on every keystroke-equivalent request. */
export const SCHOOL_SEARCH_MIN_LENGTH = 2;
const SCHOOL_SEARCH_RESULT_LIMIT = 20;

/**
 * Escapes ILIKE's own wildcard characters (`%`, `_`) and its escape
 * character itself (`\`) so user-entered text is matched literally, never
 * as a pattern - a search for "50%" or "under_grad" must not silently widen
 * to an unintended match. Postgres ILIKE's default ESCAPE character is `\`,
 * so escaping is exactly "prefix any of \ % _ with an extra \", in that
 * order (the backslash itself must be escaped first, or a literal `%` in
 * the input would double-escape into something else).
 */
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export interface SchoolSearchOutcome {
  schools: SchoolSearchResult[];
  /** A user-safe, generic message - never the raw Supabase/database error text. Null means no error occurred (including the "query too short to search" case, which is not an error). */
  error: string | null;
}

/** Shown for any search-query failure - deliberately generic so raw database/Supabase error text never reaches the user. */
const SCHOOL_SEARCH_GENERIC_ERROR = "We couldn't search schools. Try again.";

/**
 * Server-rendered school search for onboarding's "Find your school" screen
 * (Stage C design: a plain GET `?q=` query param re-rendered by the Server
 * Component itself - deliberately no client-side fetch/debounce/API-route
 * infrastructure). Selects only id/name/city/state - organizations' existing
 * `organizations_select_any_authenticated` policy (SELECT, `qual = true`)
 * already permits this for any authenticated user; not broadened for this.
 * A query shorter than SCHOOL_SEARCH_MIN_LENGTH never reaches the database
 * and is NOT an error - it's the page's own "nothing searched yet" state.
 *
 * Returns `{ schools, error }` rather than throwing or returning `[]` for
 * both cases, so the caller can distinguish "searched, zero matches" from
 * "the search itself failed" - the two must never look the same to a user
 * (a failed query must not silently read as "your school doesn't exist").
 */
export async function searchOrganizations(rawQuery: string): Promise<SchoolSearchOutcome> {
  const trimmed = rawQuery.trim();
  if (trimmed.length < SCHOOL_SEARCH_MIN_LENGTH) return { schools: [], error: null };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, city, state")
    .ilike("name", `%${escapeLikePattern(trimmed)}%`)
    .order("name")
    .limit(SCHOOL_SEARCH_RESULT_LIMIT);

  if (error) return { schools: [], error: SCHOOL_SEARCH_GENERIC_ERROR };
  return { schools: data ?? [], error: null };
}
