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
 * Creates a brand-new organization and the caller's initial admin
 * membership, via the bootstrap_organization() RPC (see
 * supabase/migrations/20260914140000_bootstrap_organization.sql). This
 * uses the normal authenticated server client - no service-role/secret
 * key. All of the actual security logic (zero-membership requirement,
 * name validation, hard-coded role/status, generated ids) lives in that
 * SECURITY DEFINER function, not here; this action only forwards the
 * form input and translates the RPC's result/error into a redirect.
 */
export async function createOrganization(formData: FormData) {
  const claims = await getAuthenticatedClaims();
  if (!claims) redirect("/login");

  const organizationName = String(formData.get("organizationName") ?? "").trim();
  if (!organizationName) redirect("/onboarding?error=Enter+your+school%27s+name.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("bootstrap_organization", {
    organization_name: organizationName,
  });

  if (error) {
    // The RPC's own RAISE EXCEPTION messages (e.g. "You already belong to
    // an organization.") are written to be shown to the user directly -
    // nothing here needs to translate or sanitize them further.
    redirect(`/onboarding?error=${encodeURIComponent(error.message || "Couldn't create your school. Try again.")}`);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.organization_id) {
    redirect("/onboarding?error=Couldn't create your school. Try again.");
  }

  // The new membership is now this user's only active one - no cookie
  // write needed (selectOrganization's cookie only matters for the
  // multi-membership case, which a brand-new organization's founder isn't
  // in). The (app) layout re-resolves the active organization from
  // scratch on the next request regardless.
  redirect("/setup");
}
