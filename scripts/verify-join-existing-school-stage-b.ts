/**
 * Regression coverage for Stage B of the join-existing-school architecture:
 *   - CREATE OR REPLACE bootstrap_organization, lock-key correction only
 *     (moved onto the shared 'organization_membership_creation:' domain).
 *   - NEW public.join_existing_school(target_organization_id uuid).
 *
 * See supabase/migrations/20260924222129_join_existing_school_stage_b_rpc.sql
 * for the full migration this file verifies.
 *
 * IMPORTANT LIMITATION - read before extending this file:
 * This repo's verify:* scripts (this one included) are static/structural -
 * they inspect source/migration TEXT and pure TypeScript functions. There is
 * no live-database test harness here (no way to open two real, independent,
 * authenticated Postgres sessions and race them against each other). That
 * means the three concurrency requirements from the Stage B review
 * (join/join, bootstrap/bootstrap, bootstrap/join for the same user) cannot
 * be TRULY exercised by this script - doing so would require either a local
 * Supabase stack with two real client connections issuing concurrent RPC
 * calls, or a dedicated integration-test environment, neither of which
 * exists in this repo today. Faking a "concurrency test" by calling the SQL
 * function body's logic twice in a single Node process would prove nothing
 * about actual Postgres transaction/lock semantics and would be worse than
 * not testing it at all - so this file does not pretend to.
 *
 * What IS verified instead, deterministically, from the migration text
 * itself (section 8 below): both functions acquire
 * pg_advisory_xact_lock(hashtextextended('organization_membership_creation:'
 * || v_user_id::text, 0)) - the IDENTICAL key - strictly BEFORE their own
 * "does this user already have an active membership" check, which in turn
 * runs strictly BEFORE their own INSERT into organization_memberships. Given
 * Postgres's documented pg_advisory_xact_lock semantics (a session-exclusive
 * lock held for the remainder of the calling transaction, blocking any other
 * session requesting the same key until that transaction ends), this
 * ordering is what makes the three concurrency guarantees hold - the
 * guarantee is a property of the SQL as written, not something this script
 * can independently re-observe without a live concurrent-session harness.
 * If a future milestone adds one (e.g. a docker-compose local Supabase stack
 * with a Node test driver opening two real connections), replace this
 * explanation with real concurrent assertions rather than deleting it.
 *
 *   npx tsx scripts/verify-join-existing-school-stage-b.ts
 */

import { readFileSync } from "node:fs";
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

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const STAGE_B_PATH = "supabase/migrations/20260924222129_join_existing_school_stage_b_rpc.sql";
const stageB = source(STAGE_B_PATH);

function extractFunctionBody(fullSource: string, functionName: string): string {
  const pattern = new RegExp(
    `create or replace function public\\.${functionName}\\([^)]*\\)[\\s\\S]*?\\nas \\$\\$([\\s\\S]*?)\\nend;\\n\\$\\$;`,
  );
  const match = fullSource.match(pattern);
  return match ? match[1] : "";
}

function extractSignatureLine(fullSource: string, functionName: string): string {
  const match = fullSource.match(new RegExp(`create or replace function public\\.${functionName}\\(([^)]*)\\)`));
  return match ? match[1].trim() : "";
}

/** Strips SQL line comments (-- ...) so prose inside them can't produce a false-positive match against functional SQL. */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

console.log("1. Migration file exists and defines both functions");
{
  check("1a: bootstrap_organization is CREATE OR REPLACE'd in this file", /create or replace function public\.bootstrap_organization\(/.test(stageB));
  check("1b: join_existing_school is created in this file", /create or replace function public\.join_existing_school\(/.test(stageB));
}

const bootstrapBody = extractFunctionBody(stageB, "bootstrap_organization");
const joinBody = extractFunctionBody(stageB, "join_existing_school");

console.log("\n2. bootstrap_organization: ONLY the lock key changed, every other behavior preserved verbatim");
{
  check("2a: found bootstrap_organization's body to inspect", bootstrapBody.length > 0);
  check(
    "2b: the OLD function-specific lock key is gone - no live code path locks on 'bootstrap_organization:' anymore",
    !stageB.includes("hashtextextended('bootstrap_organization:'"),
  );
  check(
    "2c: bootstrap_organization now locks on the shared 'organization_membership_creation:' domain",
    /pg_advisory_xact_lock\(hashtextextended\('organization_membership_creation:' \|\| v_user_id::text, 0\)\)/.test(bootstrapBody),
  );
  check("2d: auth.uid() is still the only identity input", /v_user_id uuid := auth\.uid\(\)/.test(bootstrapBody));
  check("2e: unauthenticated rejection preserved", /if v_user_id is null then[\s\S]*?Authentication required\./.test(bootstrapBody));
  check("2f: profile-existence check preserved", /from public\.profiles[\s\S]*?where id = v_user_id/.test(bootstrapBody));
  check(
    "2g: active-membership rejection preserved, unconditional (no organization_id filter)",
    /where m\.user_id = v_user_id[\s\S]*?and m\.status = 'active'[\s\S]*?already belong to an organization/.test(bootstrapBody),
  );
  check("2h: organization creation preserved (insert into public.organizations)", /insert into public\.organizations \(name, slug\)/.test(bootstrapBody));
  check("2i: slug generation preserved (internally generated, never caller-supplied)", /v_slug := left\(v_base_slug, 40\)/.test(bootstrapBody));
  check(
    "2j: membership insert still hard-codes role='admin', status='active', account_origin='cloud_native'",
    /insert into public\.organization_memberships \(organization_id, user_id, role, status, account_origin\)[\s\S]*?values \(v_organization_id, v_user_id, 'admin', 'active', 'cloud_native'\)/.test(
      bootstrapBody,
    ),
  );
  check("2k: return shape preserved (organization_id, membership_id)", /return query select v_organization_id, v_membership_id;/.test(bootstrapBody));
}

console.log("\n3. bootstrap_organization's privileges are NOT touched by this migration (CREATE OR REPLACE preserves grants on the same OID)");
{
  check(
    "3a: this file contains no functional GRANT/REVOKE EXECUTE statement naming bootstrap_organization (comment prose mentioning both words is not a match) - its existing authenticated-only privilege (audited live before writing this migration: proacl = {postgres=X/postgres,authenticated=X/postgres}) is left exactly as-is",
    !/(grant|revoke)\s+execute\s+on\s+function\s+public\.bootstrap_organization/i.test(stripLineComments(stageB)),
  );
}

console.log("\n4. join_existing_school: accepts ONLY target_organization_id - no caller control over identity or membership fields");
{
  const signature = extractSignatureLine(stageB, "join_existing_school");
  check("4a: found join_existing_school's signature to inspect", signature.length > 0);
  check("4b: the ENTIRE parameter list is exactly target_organization_id uuid - nothing else is accepted", signature === "target_organization_id uuid");
  check("4c: join_existing_school's body was found to inspect", joinBody.length > 0);
  check("4d: identity comes solely from auth.uid()", /v_user_id uuid := auth\.uid\(\)/.test(joinBody));
  check("4e: unauthenticated caller rejected", /if v_user_id is null then[\s\S]*?Authentication required\./.test(joinBody));
  check("4f: profile-existence check present", /from public\.profiles[\s\S]*?where id = v_user_id/.test(joinBody));
  check(
    "4g: nonexistent target organization rejected before any insert",
    /if not exists \(select 1 from public\.organizations o where o\.id = target_organization_id\) then[\s\S]*?Organization not found\./.test(joinBody),
  );
  check(
    "4h: active-membership rejection present, unconditional (identical shape to bootstrap_organization's own check)",
    /where m\.user_id = v_user_id[\s\S]*?and m\.status = 'active'[\s\S]*?already belong to an organization/.test(joinBody),
  );
  check(
    "4i: the membership insert hard-codes role='teacher', status='active', account_origin='cloud_native' - none of these, nor user_id/membership_id, are ever read from a function parameter (proven by 4b: the only parameter is target_organization_id)",
    /insert into public\.organization_memberships \(organization_id, user_id, role, status, account_origin\)[\s\S]*?values \(target_organization_id, v_user_id, 'teacher', 'active', 'cloud_native'\)/.test(
      joinBody,
    ),
  );
  check(
    "4j: no FUNCTIONAL status='invited' path exists in this function (only explanatory comment prose mentions the word, e.g. 'never 'invited'' - stripped before this check) - private beta joins active immediately, per the approved architecture",
    !stripLineComments(joinBody).includes("'invited'"),
  );
  check("4k: return shape is (organization_id, membership_id)", /return query select target_organization_id, v_membership_id;/.test(joinBody));
  check("4l: join_existing_school never UPDATEs or DELETEs organization_memberships - insert-only, same as bootstrap_organization", !/update public\.organization_memberships|delete from public\.organization_memberships/.test(joinBody));
}

console.log("\n5. Shared advisory-lock domain: identical key in both functions, used exactly twice, nowhere else");
{
  const lockCallPattern = /pg_advisory_xact_lock\(hashtextextended\('organization_membership_creation:' \|\| v_user_id::text, 0\)\)/g;
  const matches = stageB.match(lockCallPattern) ?? [];
  check("5a: the shared lock call appears exactly twice (once per function)", matches.length === 2);
  check(
    "5b: join_existing_school locks BEFORE it checks for an existing active membership, which runs BEFORE its own insert - the ordering that makes the shared lock actually serialize the two functions against each other (see file header for why this ordering, not a live concurrency run, is what's verifiable here)",
    (() => {
      const lockIdx = joinBody.indexOf("pg_advisory_xact_lock");
      const activeCheckIdx = joinBody.indexOf("already belong to an organization");
      const insertIdx = joinBody.indexOf("insert into public.organization_memberships");
      return lockIdx !== -1 && activeCheckIdx !== -1 && insertIdx !== -1 && lockIdx < activeCheckIdx && activeCheckIdx < insertIdx;
    })(),
  );
  check(
    "5c: bootstrap_organization locks BEFORE it checks for an existing active membership, which runs BEFORE its own insert - identical ordering to 5b",
    (() => {
      const lockIdx = bootstrapBody.indexOf("pg_advisory_xact_lock");
      const activeCheckIdx = bootstrapBody.indexOf("already belong to an organization");
      const insertIdx = bootstrapBody.indexOf("insert into public.organization_memberships");
      return lockIdx !== -1 && activeCheckIdx !== -1 && insertIdx !== -1 && lockIdx < activeCheckIdx && activeCheckIdx < insertIdx;
    })(),
  );
}

console.log("\n6. join_existing_school privileges: authenticated-only, matching bootstrap_organization's own pattern");
{
  check("6a: EXECUTE revoked from public", /revoke execute on function public\.join_existing_school\(uuid\) from public;/.test(stageB));
  check("6b: EXECUTE revoked from anon", /revoke execute on function public\.join_existing_school\(uuid\) from anon;/.test(stageB));
  check("6c: EXECUTE granted to authenticated (and nothing broader)", /grant execute on function public\.join_existing_school\(uuid\) to authenticated;/.test(stageB));
  check("6d: no grant to anon or public anywhere in this file", !/grant execute[\s\S]*?to (anon|public)/i.test(stageB));
}

console.log("\n7. Stage B does not redesign RLS or add a self-service membership INSERT policy");
{
  check(
    "7a: this migration file contains no CREATE POLICY / ALTER POLICY statement - membership creation stays RPC-only, not a new direct-insert grant",
    !/create policy|alter policy/i.test(stageB),
  );
  check(
    "7b: this migration file does not touch organization_memberships' RLS at all (no ENABLE/DISABLE ROW LEVEL SECURITY, no ALTER TABLE organization_memberships)",
    !/organization_memberships[\s\S]{0,40}(row level security|enable rls)/i.test(stageB) && !/alter table public\.organization_memberships/i.test(stageB),
  );
  // Recorded from the live audit performed immediately before this migration
  // was authored (pg_policies on organization_memberships): the only INSERT
  // policy is organization_memberships_insert_admin_only, with_check =
  // app_is_admin(organization_id) - there is no self-service insert path for
  // an ordinary authenticated user today. This script has no live-database
  // connection, so this fact is asserted as an audited snapshot, not
  // re-queried here - a live re-audit (get_advisors / pg_policies) is the
  // right tool if this ever needs re-confirming against a real database.
  console.log("  note - 7c: live audit (recorded, not re-queried by this static script) confirmed organization_memberships' only INSERT policy is organization_memberships_insert_admin_only (with_check = app_is_admin(organization_id)) - no ordinary authenticated user can INSERT their own membership row directly, today or after this migration.");
}

console.log("\n8. No seed data, no unrelated schema changes, no scope creep beyond the two RPCs and their grants");
{
  check("8a: no INSERT/UPDATE/DELETE against organizations or organization_memberships outside the two function bodies (no top-level DML statement in this file)", (() => {
    const withoutFunctionBodies = stageB.replace(/as \$\$[\s\S]*?\nend;\n\$\$;/g, "");
    return !/^\s*(insert|update|delete)\s/im.test(withoutFunctionBodies);
  })());
  check("8b: no reference to organization_settings", !stageB.includes("organization_settings"));
  check("8c: no reference to external_id", !stageB.includes("external_id"));
  check("8d: no known production school name is referenced (no seeding)", !/Ogemaw|Test School|Oscoda/i.test(stageB));
  check("8e: no teacher_period_assignments reference (no seeding of shared-schedule test data)", !stageB.includes("teacher_period_assignments"));
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
