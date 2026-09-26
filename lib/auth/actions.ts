"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import {
  ACTIVE_ORGANIZATION_COOKIE,
  destinationForResolution,
  getActiveMemberships,
  getAuthenticatedClaims,
  resolveActiveOrganization,
} from "./dal";

async function currentOrigin(): Promise<string> {
  const headerList = await headers();
  return headerList.get("origin") ?? "";
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?error=Enter+your+email+and+password.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);

  const resolution = await resolveActiveOrganization();
  redirect(destinationForResolution(resolution));
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) redirect("/login?mode=signup&error=Enter+your+email+and+password.");

  const supabase = await createSupabaseServerClient();
  const origin = await currentOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/confirm?type=email` },
  });
  if (error) redirect(`/login?mode=signup&error=${encodeURIComponent(error.message)}`);

  // No session yet means the project requires email confirmation before
  // sign-in - show the "check your email" state rather than redirecting
  // somewhere the user isn't actually authenticated for yet.
  if (!data.session) redirect("/login?mode=signup&sent=1");

  const resolution = await resolveActiveOrganization();
  redirect(destinationForResolution(resolution));
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?error=Enter+the+email+to+reset+the+password+for.");

  const supabase = await createSupabaseServerClient();
  const origin = await currentOrigin();
  // Deliberately ignore the result - never reveal whether an email is
  // registered via this form's response.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?type=recovery`,
  });
  redirect("/login?resetSent=1");
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!password) redirect("/auth/reset-password?error=Enter+a+new+password.");

  const claims = await getAuthenticatedClaims();
  if (!claims) redirect("/login?error=That+reset+link+expired.+Request+a+new+one.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/auth/reset-password?error=${encodeURIComponent(error.message)}`);

  const resolution = await resolveActiveOrganization();
  redirect(destinationForResolution(resolution));
}

/**
 * Real (non-stub) Phase 1 action: switches which of the user's own active
 * memberships is active for this browser. Re-validates the submitted
 * organizationId against a fresh query of that user's actual active
 * memberships before ever writing the cookie - a user can only ever select
 * an organization they already belong to, never an arbitrary one.
 */
export async function selectOrganization(formData: FormData) {
  const claims = await getAuthenticatedClaims();
  if (!claims) redirect("/login");

  const organizationId = String(formData.get("organizationId") ?? "");
  const memberships = await getActiveMemberships(claims.userId);
  const match = memberships.find((membership) => membership.organizationId === organizationId);
  if (!match) redirect("/onboarding?error=Select+one+of+your+schools.");

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect("/setup");
}

/**
 * Joins an existing organization as an active teacher, via the
 * join_existing_school() RPC (see
 * supabase/migrations/20260924222129_join_existing_school_stage_b_rpc.sql).
 * Same shape as createOrganization below: this action only forwards the
 * caller-chosen organization id and translates the RPC's result/error into
 * a redirect. All of the actual security logic (auth/profile checks, the
 * shared advisory-lock domain, the zero-active-membership requirement,
 * hard-coded role='teacher'/status='active'/account_origin='cloud_native')
 * lives in that SECURITY DEFINER function, not here - this action never
 * inserts into organization_memberships directly.
 */
export async function joinExistingSchool(formData: FormData) {
  const claims = await getAuthenticatedClaims();
  if (!claims) redirect("/login");

  const targetOrganizationId = String(formData.get("targetOrganizationId") ?? "").trim();
  if (!targetOrganizationId) redirect("/onboarding?error=Choose+a+school+to+join.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("join_existing_school", {
    target_organization_id: targetOrganizationId,
  });

  if (error) {
    // Same convention as createOrganization below: the RPC's own RAISE
    // EXCEPTION messages (e.g. "You already belong to an organization.",
    // "Organization not found.") are written to be shown to the user
    // directly - nothing here needs to translate or sanitize them further.
    redirect(`/onboarding?error=${encodeURIComponent(error.message || "Couldn't join that school. Try again.")}`);
  }

  // The new membership is now this user's only active one - no cookie
  // write needed, identical reasoning to createOrganization below. The
  // (app) layout / /setup re-resolve the active organization from scratch
  // on this next request regardless.
  redirect("/setup");
}

const MAX_LOCATION_FIELD_LENGTH = 200;

/** Trims, treats an empty string as absent, and caps length - city/state are optional, unconstrained `text` columns (no DB CHECK), so this is the only normalization they get. */
function normalizeOptionalLocationField(value: FormDataEntryValue | null): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_LOCATION_FIELD_LENGTH ? trimmed.slice(0, MAX_LOCATION_FIELD_LENGTH) : trimmed;
}

/**
 * Creates a brand-new organization and the caller's initial admin
 * membership, via the bootstrap_organization() RPC (see
 * supabase/migrations/20260914140000_bootstrap_organization.sql). This
 * uses the normal authenticated server client - no service-role/secret
 * key. All of the actual security logic (zero-membership requirement,
 * name validation, hard-coded role/status, generated ids) lives in that
 * SECURITY DEFINER function, not here; this action only forwards the
 * form input and translates the RPC's result/error into a redirect.
 *
 * city/state are NOT passed to bootstrap_organization (its signature is
 * unchanged - organization_name only). They're persisted as a separate,
 * best-effort UPDATE after the school itself already exists, scoped to
 * exactly the columns
 * supabase/migrations/20260925222855_join_existing_school_stage_c_org_location.sql
 * grants (city, state) and to exactly the row bootstrap_organization just
 * returned - never name/slug/id/timestamps, never another organization.
 */
export async function createOrganization(formData: FormData) {
  const claims = await getAuthenticatedClaims();
  if (!claims) redirect("/login");

  const organizationName = String(formData.get("organizationName") ?? "").trim();
  // Every error redirect below that surfaces a create-school failure to the
  // user must land back on the create screen (?screen=create), not the
  // default "Find your school" search screen - otherwise the founder's own
  // error message would appear next to the wrong form. Only the post-bootstrap
  // city/state failure (further below) is exempt, by design: it is
  // non-fatal and never redirects back into onboarding at all.
  if (!organizationName) redirect("/onboarding?screen=create&error=Enter+your+school%27s+name.");

  const city = normalizeOptionalLocationField(formData.get("city"));
  const state = normalizeOptionalLocationField(formData.get("state"));

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bootstrap_organization", {
    organization_name: organizationName,
  });

  if (error) {
    // The RPC's own RAISE EXCEPTION messages (e.g. "You already belong to
    // an organization.") are written to be shown to the user directly -
    // nothing here needs to translate or sanitize them further.
    redirect(
      `/onboarding?screen=create&error=${encodeURIComponent(error.message || "Couldn't create your school. Try again.")}`,
    );
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.organization_id) {
    redirect("/onboarding?screen=create&error=Couldn't create your school. Try again.");
  }

  // Optional location, persisted only if the founder entered at least one
  // of city/state. IMPORTANT: this runs strictly AFTER bootstrap_organization
  // has already succeeded - the school and the founder's admin membership
  // are real and correct at this point regardless of what happens next. A
  // failure here must never re-run bootstrap_organization (which would
  // create a SECOND organization - it has no "already exists" concept, it
  // always creates), never send the founder back into the create-school
  // form, and never be reported as "couldn't create your school." It is
  // logged server-side (console.error) as the simplest existing-compatible
  // non-fatal reporting path - no new notification/telemetry system
  // introduced for this one optional, cosmetic field.
  if (city !== null || state !== null) {
    const { error: locationError } = await supabase
      .from("organizations")
      .update({ city, state })
      .eq("id", result.organization_id);
    if (locationError) {
      console.error(
        `[createOrganization] bootstrap_organization succeeded (organization ${result.organization_id}) but setting city/state failed - continuing to /setup regardless:`,
        locationError.message,
      );
    }
  }

  // The new membership is now this user's only active one - no cookie
  // write needed (selectOrganization's cookie only matters for the
  // multi-membership case, which a brand-new organization's founder isn't
  // in). The (app) layout re-resolves the active organization from
  // scratch on the next request regardless.
  redirect("/setup");
}
