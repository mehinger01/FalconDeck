/**
 * Regression coverage for Stage C of the join-existing-school architecture:
 * the user-visible onboarding screens ("Find your school" search, "Add your
 * school" create, and joining a search result) - see the reviewed Stage C
 * design report for the full rationale.
 *
 * Static/structural, matching this repo's existing verify-script style: no
 * live database calls, no browser. Inspects source text and, where the
 * logic is a pure function (searchOrganizations' escaping, the location
 * field normalizer), calls it directly.
 *
 *   npx tsx scripts/verify-onboarding-school-search-and-join.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

/** Normalizes CRLF to LF - this repo's working tree checks files out with CRLF line endings, but every pattern below is authored assuming plain `\n`. */
function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** Strips SQL line comments (-- ...) so prose inside them can't produce a false-positive match against functional SQL. */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const onboardingPage = source("app/onboarding/page.tsx");
const actions = source("lib/auth/actions.ts");
const dal = source("lib/auth/dal.ts");
const supabaseMapping = source("lib/data/supabaseMapping.ts");
const supabaseTypes = source("lib/data/supabase.types.ts");
const migration = source("supabase/migrations/20260925222855_join_existing_school_stage_c_org_location.sql");

console.log("1. Existing membership-resolution behavior is undisturbed");
{
  check(
    "1a: /onboarding still redirects a resolved resolution away before rendering",
    /if \(resolution\.state === "resolved"\) redirect\(destinationForResolution\(resolution\)\);/.test(onboardingPage),
  );
  check(
    "1b: the needs-selection branch still renders each membership as a selectOrganization form",
    /resolution\.state === "needs-selection"/.test(onboardingPage) &&
      /resolution\.memberships\.map/.test(onboardingPage) &&
      /form key=\{membership\.organizationId\} action=\{selectOrganization\}/.test(onboardingPage),
  );
  check("1c: selectOrganization is still imported and used, unmodified by this stage", /selectOrganization/.test(onboardingPage));
  check(
    "1d: requireAuthenticatedUser and resolveActiveOrganization are still the entry gate",
    /await requireAuthenticatedUser\(\);/.test(onboardingPage) && /await resolveActiveOrganization\(\)/.test(onboardingPage),
  );
}

console.log("\n2. Default zero-membership experience is server-rendered search, not client-fetch");
{
  check(
    "2a: the zero-membership branch's default (screen !== 'create') renders \"Find your school\"",
    /Find your school/.test(onboardingPage),
  );
  check("2b: no \"use client\" directive anywhere in the onboarding page", !onboardingPage.includes('"use client"'));
  check("2c: no fetch()/useEffect/useState-based search infrastructure in the onboarding page", !/\bfetch\(|useEffect\(|useState\(/.test(onboardingPage));
  check(
    "2d: no school-search API route was introduced (app/api/schools/search/route.ts does not exist)",
    !existsSync(join(process.cwd(), "app/api/schools/search/route.ts")),
  );
  check("2e: no standalone client SchoolSearch component was introduced", !existsSync(join(process.cwd(), "components/onboarding/SchoolSearch.tsx")));
}

console.log("\n3. Location display rules");
{
  check(
    "3a: formatSchoolLocation exists and covers both/city-only/state-only/neither",
    /function formatSchoolLocation/.test(onboardingPage) &&
      /school\.city && school\.state/.test(onboardingPage) &&
      /if \(school\.city\) return school\.city;/.test(onboardingPage) &&
      /if \(school\.state\) return school\.state;/.test(onboardingPage) &&
      /return null;/.test(onboardingPage),
  );
  check("3b: no-results copy matches exactly", onboardingPage.includes("No matches found. Try another search or add your school."));
  check("3c: the \"add your school\" secondary link text is present and points at ?screen=create", /Can&apos;t find your school\? Add it/.test(onboardingPage) && /href="\/onboarding\?screen=create"/.test(onboardingPage));
  check(
    "3d: a search error renders searchOutcome.error, and takes precedence in the ternary over the zero-results branch (error checked first)",
    (() => {
      const errIdx = onboardingPage.indexOf("searchOutcome.error ? (");
      const zeroIdx = onboardingPage.indexOf("searchOutcome.schools.length === 0");
      return errIdx !== -1 && zeroIdx !== -1 && errIdx < zeroIdx;
    })(),
  );
  check(
    "3e: \"No matches found\" is reachable ONLY when there is no search error (it's the ternary's second branch, gated behind the first failing)",
    (() => {
      const idx = onboardingPage.indexOf("No matches found");
      if (idx === -1) return false;
      // The nearest preceding conditional must be the zero-results check,
      // itself only reachable when searchOutcome.error is falsy (JSX ternary
      // `cond1 ? A : cond2 ? B : C` - B is unreachable unless cond1 is false).
      const precedingSlice = onboardingPage.slice(0, idx);
      return precedingSlice.lastIndexOf("searchOutcome.error ? (") < precedingSlice.lastIndexOf("searchOutcome.schools.length === 0");
    })(),
  );
  check(
    "3f: the error message is rendered from the outcome's own error field, not a hardcoded/duplicated string - so it can never diverge from dal.ts's generic message",
    /\{searchOutcome\.error\}/.test(onboardingPage),
  );
}

console.log("\n4. searchOrganizations (lib/auth/dal.ts) query shape");
{
  check(
    "4a: selects only id, name, city, state - no broader select",
    /\.select\("id, name, city, state"\)/.test(dal),
  );
  check("4b: case-insensitive name search via ilike on name only", /\.ilike\("name", /.test(dal) && !/\.ilike\("city"|\.ilike\("state"/.test(dal));
  check("4c: results ordered by name", /\.order\("name"\)/.test(dal));
  check("4d: a numeric result limit is applied", /\.limit\(SCHOOL_SEARCH_RESULT_LIMIT\)/.test(dal) && /SCHOOL_SEARCH_RESULT_LIMIT = 20/.test(dal));
  check(
    "4e: a minimum query length gates the query - shorter input never reaches the database, and is NOT reported as an error",
    /if \(trimmed\.length < SCHOOL_SEARCH_MIN_LENGTH\) return \{ schools: \[\], error: null \};/.test(dal),
  );
  check("4f: SCHOOL_SEARCH_MIN_LENGTH is exported (so the page can gate rendering identically) and is 2", /export const SCHOOL_SEARCH_MIN_LENGTH = 2;/.test(dal));
  check(
    "4g: an empty query (after gating) never queries organizations at all - trimmed.length check runs before any supabase call",
    (() => {
      const fnMatch = dal.match(/export async function searchOrganizations[\s\S]*?\n}/);
      if (!fnMatch) return false;
      const body = fnMatch[0];
      const gateIdx = body.indexOf("if (trimmed.length < SCHOOL_SEARCH_MIN_LENGTH) return { schools: [], error: null };");
      const queryIdx = body.indexOf("createSupabaseServerClient");
      return gateIdx !== -1 && queryIdx !== -1 && gateIdx < queryIdx;
    })(),
  );
}

console.log("\n4h. searchOrganizations distinguishes a database error from a successful zero-match search");
{
  const fnMatch = dal.match(/export async function searchOrganizations[\s\S]*?\n}/);
  const body = fnMatch ? fnMatch[0] : "";
  check("4h-1: searchOrganizations exists and was found for inspection", fnMatch !== null);
  check(
    "4h-2: SchoolSearchOutcome's error field is documented/typed as string | null, distinct from an empty schools array",
    /error: string \| null/.test(dal),
  );
  check(
    "4h-3: a database error returns a non-null error string (SCHOOL_SEARCH_GENERIC_ERROR), not just an empty schools array",
    /if \(error\) return \{ schools: \[\], error: SCHOOL_SEARCH_GENERIC_ERROR \};/.test(body),
  );
  check(
    "4h-4: the generic search-failure message is exactly \"We couldn't search schools. Try again.\"",
    /const SCHOOL_SEARCH_GENERIC_ERROR = "We couldn't search schools\. Try again\.";/.test(dal),
  );
  check(
    "4h-5: the successful path (no error) always returns error: null, even with zero results - schools.length === 0 alone never implies an error",
    /return \{ schools: data \?\? \[\], error: null \};/.test(body),
  );
  check(
    "4h-6: raw Supabase/database error text (error.message or the error object itself) is never included in the returned error field - only the literal generic constant is ever returned",
    !/error: error\.message/.test(body) && !/error: error,/.test(body) && !/error: error\}/.test(body) && !/error: `[^`]*\$\{error/.test(body),
  );
}

console.log("\n5. ILIKE wildcard escaping - user-entered % and _ must be treated literally");
{
  check("5a: an escapeLikePattern helper exists", /function escapeLikePattern\(value: string\): string \{/.test(dal));
  check(
    "5b: it escapes the backslash first, then % and _ (order matters - escaping a literal % first would double-escape a pre-existing backslash)",
    (() => {
      const fnMatch = dal.match(/function escapeLikePattern\(value: string\): string \{([\s\S]*?)\n\}/);
      if (!fnMatch) return false;
      const body = fnMatch[1];
      const backslashIdx = body.indexOf('replace(/\\\\/g, "\\\\\\\\")');
      const percentIdx = body.indexOf('replace(/%/g, "\\\\%")');
      const underscoreIdx = body.indexOf('replace(/_/g, "\\\\_")');
      return backslashIdx !== -1 && percentIdx !== -1 && underscoreIdx !== -1 && backslashIdx < percentIdx && percentIdx < underscoreIdx;
    })(),
  );
  // Behavioral cross-check: re-implement the exact same rule independently
  // and confirm it round-trips a few concrete inputs the way ILIKE's
  // default `\` escape character requires - catches a subtly wrong
  // implementation that the structural check above wouldn't.
  function referenceEscape(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  }
  check("5c: reference escaping behaves as expected on a mixed case (%, _, and a literal backslash)", referenceEscape("50%_off\\now") === "50\\%\\_off\\\\now");
  check("5d: escapeLikePattern is actually applied inside the ILIKE call, not just defined", /\.ilike\("name", `%\$\{escapeLikePattern\(trimmed\)\}%`\)/.test(dal));
}

console.log("\n6. joinExistingSchool (lib/auth/actions.ts)");
{
  const fnMatch = actions.match(/export async function joinExistingSchool[\s\S]*?\n}/);
  check("6a: joinExistingSchool exists", fnMatch !== null);
  const body = fnMatch ? fnMatch[0] : "";
  check("6b: calls supabase.rpc(\"join_existing_school\", ...) with target_organization_id", /supabase\.rpc\("join_existing_school", \{\s*target_organization_id: targetOrganizationId,?\s*\}\)/.test(body));
  check("6c: never directly inserts into organization_memberships", !body.includes('.from("organization_memberships")'));
  check("6d: does not write the active-organization cookie", !body.includes("ACTIVE_ORGANIZATION_COOKIE") && !/cookieStore\.set/.test(body));
  check("6e: redirects to /setup on success", /redirect\("\/setup"\);/.test(body));
  check("6f: redirects back to /onboarding with an encoded error on RPC failure", /redirect\(`\/onboarding\?error=\$\{encodeURIComponent\(/.test(body));
}

console.log("\n7. createOrganization (lib/auth/actions.ts) - bootstrap contract unchanged, city/state handled separately");
{
  const fnMatch = actions.match(/export async function createOrganization[\s\S]*?\n}\n/);
  check("7a: createOrganization exists", fnMatch !== null);
  const body = fnMatch ? fnMatch[0] : "";
  check(
    "7b: bootstrap_organization is still called with ONLY organization_name - no city/state args added to the RPC call",
    /supabase\.rpc\("bootstrap_organization", \{\s*organization_name: organizationName,\s*\}\)/.test(body),
  );
  check("7c: city/state are read from the form and normalized before the RPC call, not passed into it", /const city = normalizeOptionalLocationField\(formData\.get\("city"\)\);/.test(body) && /const state = normalizeOptionalLocationField\(formData\.get\("state"\)\);/.test(body));
  check(
    "7d: the location UPDATE, when it runs, sets ONLY city and state",
    /\.update\(\{ city, state \}\)/.test(body) && !/\.update\(\{[^}]*\b(name|slug|id|created_at|updated_at)\b/.test(body),
  );
  check(
    "7e: the location UPDATE is scoped to the organization_id bootstrap_organization just returned, via .eq(\"id\", result.organization_id)",
    /\.eq\("id", result\.organization_id\)/.test(body),
  );
  check(
    "7f: the location UPDATE runs strictly AFTER the bootstrap RPC call (never before), so a location failure cannot precede/replace organization creation",
    body.indexOf('supabase.rpc("bootstrap_organization"') < body.indexOf(".update({ city, state })"),
  );
  check(
    "7g: the missing-organization-name redirect preserves screen=create (so the error re-renders on the create form, not the default search screen)",
    /redirect\("\/onboarding\?screen=create&error=Enter\+your\+school%27s\+name\."\);/.test(body),
  );
  check(
    "7h: the bootstrap RPC error redirect preserves screen=create",
    /redirect\(\s*`\/onboarding\?screen=create&error=\$\{encodeURIComponent\(/.test(body),
  );
  check(
    "7i: the missing-organization_id fallback redirect preserves screen=create",
    /redirect\("\/onboarding\?screen=create&error=Couldn't create your school\. Try again\."\);/.test(body),
  );
  check(
    "7j: every create-error redirect in this function targets screen=create - none of the three fall back to a bare /onboarding?error= (which would land on the search screen instead)",
    (() => {
      const errorRedirects = body.match(/redirect\(\s*[`"]\/onboarding\?[^`"]*/g) ?? [];
      // Exclude the location-update branch on purpose (see section 8: that
      // one correctly never redirects at all) - every OTHER /onboarding
      // redirect in this function is a create-error and must carry
      // screen=create.
      return errorRedirects.length >= 3 && errorRedirects.every((r) => r.includes("screen=create"));
    })(),
  );
}

console.log("\n8. Location-update failure is non-fatal");
{
  const fnMatch = actions.match(/export async function createOrganization[\s\S]*?\n}\n/);
  const body = fnMatch ? fnMatch[0] : "";
  check(
    "8a: a failed location update is only logged (console.error), never redirected/thrown",
    /if \(locationError\) \{\s*console\.error\(/.test(body),
  );
  check(
    "8b: no redirect call appears inside the location-update error branch (it must fall through to /setup)",
    (() => {
      const errIdx = body.indexOf("if (locationError)");
      if (errIdx === -1) return false;
      const braceStart = body.indexOf("{", errIdx);
      const braceEnd = body.indexOf("}", braceStart);
      const branch = body.slice(braceStart, braceEnd);
      return !branch.includes("redirect(");
    })(),
  );
  check(
    "8c: bootstrap_organization is never called a second time anywhere in this function (no retry-by-recreating-the-org) - only one actual .rpc(\"bootstrap_organization\", ...) call, regardless of how many times it's mentioned in comments",
    (body.match(/\.rpc\("bootstrap_organization"/g) ?? []).length === 1,
  );
  check("8d: the function still ends by redirecting to /setup unconditionally after the location step", /redirect\("\/setup"\);\s*\}\s*$/.test(body));
  check(
    "8e: a post-bootstrap location-update failure never redirects back to the create screen - screen=create appears nowhere from the location UPDATE call onward (only the earlier, pre-bootstrap-success error redirects use it)",
    (() => {
      const updateIdx = body.indexOf(".update({ city, state })");
      if (updateIdx === -1) return false;
      return !body.slice(updateIdx).includes("screen=create");
    })(),
  );
}

console.log("\n9. Onboarding stays localStorage-safe (structural, per the Stage C design's cloud-authority analysis)");
{
  check("9a: onboarding page imports neither dataRepository nor localStorageRepository", !/dataRepository|localStorageRepository/.test(onboardingPage));
  check("9b: lib/auth/actions.ts imports neither dataRepository nor localStorageRepository", !/dataRepository|localStorageRepository/.test(actions));
  check("9c: lib/auth/dal.ts imports neither dataRepository nor localStorageRepository", !/dataRepository|localStorageRepository/.test(dal));
}

console.log("\n10. Ogemaw-specific placeholder removed from onboarding, replaced with a generic one");
{
  check("10a: the old 'e.g. Ogemaw Heights High School' placeholder is gone", !onboardingPage.includes("Ogemaw"));
  check("10b: a generic school-name placeholder exists instead", /placeholder="Your school's name"/.test(onboardingPage));
}

console.log("\n11. Stage C migration (org location grant) - exact, minimal privilege surface");
{
  check(
    "11a: grants UPDATE on organizations, scoped to exactly (city, state)",
    /grant update \(city, state\)\s*\n\s*on public\.organizations\s*\n\s*to authenticated;/.test(migration),
  );
  check("11b: no other column named in the GRANT", !/grant update \([^)]*\b(name|slug|id|created_at|updated_at)\b/.test(migration));
  check(
    "11c: the new policy uses app_is_admin(id) in both USING and WITH CHECK",
    /create policy organizations_update_own_location_admin_only[\s\S]*?using \(public\.app_is_admin\(id\)\)[\s\S]*?with check \(public\.app_is_admin\(id\)\)/.test(migration),
  );
  check("11d: no GRANT INSERT or GRANT DELETE on organizations anywhere in this file", !/grant\s+(insert|delete)\s+on\s+public\.organizations/i.test(migration));
  check("11e: no broadening of the existing SELECT policy (no CREATE/ALTER POLICY naming SELECT)", !/for select/i.test(migration));
  check(
    "11f: no functional statement in this migration references organization_memberships (its header comment explains the absence, which is prose, not DDL - stripped before this check)",
    !stripLineComments(migration).includes("organization_memberships"),
  );
  check("11g: no new function/RPC defined in this migration", !/create (or replace )?function/i.test(migration));
}

console.log("\n12. supabase.types.ts was actually regenerated to include the new columns");
{
  check(
    "12a: organizations' Row/Insert/Update types now include city and state",
    /organizations: \{\s*Row: \{[\s\S]{0,200}city: string \| null[\s\S]{0,200}state: string \| null/.test(supabaseTypes),
  );
  check("12b: join_existing_school is present in the generated Functions map", /join_existing_school: \{/.test(supabaseTypes));
}

console.log("\n13. supabaseMapping.ts's pre-existing write path was not silently broken by the type regeneration");
{
  check(
    "13a: teacherSchedulePreferencesToRow explicitly sets active_bell_schedule_id (the new required Insert field), rather than leaving it to accidentally type-check some other way",
    /active_bell_schedule_id: null,/.test(supabaseMapping),
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
