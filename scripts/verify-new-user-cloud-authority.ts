/**
 * Regression coverage for the private-beta blocker where a brand-new
 * teacher account, created fresh on teachdeckapp.com, landed on /setup
 * showing "OGEMAW HEIGHTS FALCONS", classes/schedule already checked off,
 * and migration/restore controls that make no sense for an account that
 * has never had any local data.
 *
 * ROOT CAUSE (see the account-origin architecture review, 2026-09-22, for
 * the full trace): `local_data_migrated_at` was overloaded as both "has
 * migration finished" AND "is this account cloud-authoritative" AND "does
 * this account even have a legacy-migration concept." bootstrap_organization()
 * never set it, so a brand-new membership defaulted to null - structurally
 * indistinguishable from a genuine legacy account still waiting to migrate.
 *
 * FIX, STATUS AS OF THIS FILE:
 *   Stage A (schema) - DONE. organization_memberships gained a new
 *   `account_origin` column ('cloud_native' | 'legacy_import'), backfilled
 *   explicitly by id for the two known production memberships. See
 *   supabase/migrations/20260922000000_organization_memberships_account_origin.sql.
 *   `local_data_migrated_at` itself is untouched - it keeps exactly one
 *   meaning (has migration finished), never fabricated for any row.
 *
 *   Stage B (read path) - DONE, covered by this file. getActiveMemberships
 *   (lib/auth/dal.ts) now selects/returns account_origin.
 *   deriveDataAuthorityState (lib/auth/dataAuthority.ts) derives authority
 *   from account_origin first, consulting local_data_migrated_at only to
 *   distinguish pending vs. complete within a legacy_import membership -
 *   never to decide origin, and never inventing a timestamp for a
 *   cloud_native account. MigrationSetupCard's gate was refactored from
 *   `migratedAt !== null` to an explicit `migrationPending` boolean
 *   (authority.kind === "local") so it can never be fooled by a null
 *   timestamp that means "not applicable" rather than "not done yet."
 *
 *   Stage C (write path) - DONE, covered by this file. bootstrap_organization()
 *   (supabase/migrations/20260922010000_bootstrap_organization_cloud_native.sql,
 *   a CREATE OR REPLACE FUNCTION of the original from
 *   20260914140000_bootstrap_organization.sql) now explicitly inserts
 *   account_origin='cloud_native' into the membership row it creates.
 *   Stage A's `alter column account_origin set default 'cloud_native'`
 *   already made an omitted-column insert correct before this stage - a
 *   brand-new membership already derived 'cloud-ready' authority either
 *   way. Stage C is about explicit intent, not correctness: a brand-new
 *   membership's origin is now a decision bootstrap_organization states
 *   on purpose in its own INSERT, not something that happens to fall out
 *   of a schema default it never mentions - see section 4 below.
 *   local_data_migrated_at is NOT part of this INSERT and stays NULL for
 *   a cloud_native row in every stage, including after Stage C - it is
 *   never fabricated.
 *
 * Compounding structural issue, unchanged by any stage above:
 * LocalStorageDataRepository's storage key ("falcon-deck:app-data:v1") is
 * a single, GLOBAL key with no per-user/per-organization namespacing -
 * it's scoped only to the BROWSER ORIGIN. Stage B already closes the part
 * that matters most: a cloud_native (or migrated legacy_import) account's
 * authority never resolves to "local," so its session never constructs
 * LocalStorageDataRepository at all - see section 2/8 below.
 *
 * Separately, "Ogemaw Heights Falcons" (components/layout/NavBar.tsx) was
 * a plain hardcoded string, shown to every user unconditionally,
 * regardless of authority or organization - a distinct, purely cosmetic
 * single-tenant/branding leftover explicitly deferred, not touched by any
 * stage of this (data-authority) fix. It was subsequently fixed as its own
 * later task (NavBar now renders the resolved organization name) - see
 * scripts/verify-navbar-organization.ts for that fix's own coverage;
 * section 7 below is updated to match rather than left asserting the
 * since-fixed hardcode.
 *
 *   npx tsx scripts/verify-new-user-cloud-authority.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveDataAuthorityState } from "@/lib/auth/dataAuthority";
import { selectDataRepositoryPolicy } from "@/lib/store/selectDataRepository";
import { dataRepository } from "@/lib/data/localStorageRepository";
import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import type { ActiveOrganizationResolution, ActiveMembership } from "@/lib/auth/dal";

// selectDataRepositoryPolicy's "cloud-ready" branch constructs a real
// (browser-key-only) Supabase client, which needs these two publishable
// env vars present - tsx doesn't auto-load .env.local the way `next`
// does, so load it manually, matching verify-supabase-migration.ts's
// own established pattern.
function loadEnvLocal() {
  try {
    const contents = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of contents.split("\n")) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  } catch {
    // .env.local is optional if the caller already exported the vars.
  }
}
loadEnvLocal();

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

function membership(overrides: Partial<ActiveMembership>): ActiveMembership {
  return {
    membershipId: "membership-1",
    organizationId: "org-1",
    organizationName: "Some School",
    role: "admin",
    accountOrigin: "legacy_import",
    localDataMigratedAt: null,
    ...overrides,
  };
}

/** Mirrors app/(app)/setup/page.tsx's exact derivation - "local" is the only kind that means migration is pending. */
function migrationPendingForSetupPage(authority: ReturnType<typeof deriveDataAuthorityState>): boolean {
  return authority.kind === "local";
}

console.log("1. deriveDataAuthorityState - the four account_origin x local_data_migrated_at combinations that matter");
{
  const cloudNativeNull: ActiveOrganizationResolution = {
    state: "resolved",
    membership: membership({ accountOrigin: "cloud_native", localDataMigratedAt: null }),
  };
  const legacyUnmigrated: ActiveOrganizationResolution = {
    state: "resolved",
    membership: membership({ accountOrigin: "legacy_import", localDataMigratedAt: null }),
  };
  const legacyMigrated: ActiveOrganizationResolution = {
    state: "resolved",
    membership: membership({ accountOrigin: "legacy_import", localDataMigratedAt: "2026-09-21T00:00:00.000Z" }),
  };

  check("1a: cloud_native + null timestamp -> cloud-ready", deriveDataAuthorityState(cloudNativeNull).kind === "cloud-ready");
  check("1b: legacy_import + null timestamp -> local", deriveDataAuthorityState(legacyUnmigrated).kind === "local");
  check("1c: legacy_import + non-null timestamp -> cloud-ready", deriveDataAuthorityState(legacyMigrated).kind === "cloud-ready");

  const cloudNativeState = deriveDataAuthorityState(cloudNativeNull);
  check(
    "1d: cloud_native's derived migratedAt is null, never fabricated - no migration ever happened for this account",
    cloudNativeState.kind === "cloud-ready" && cloudNativeState.migratedAt === null,
  );
  const legacyMigratedState = deriveDataAuthorityState(legacyMigrated);
  check(
    "1e: legacy_import's derived migratedAt is the real completion timestamp, untouched",
    legacyMigratedState.kind === "cloud-ready" && legacyMigratedState.migratedAt === "2026-09-21T00:00:00.000Z",
  );
}

console.log("\n2. selectDataRepositoryPolicy - 'local' always selects the SAME shared, unscoped localStorage singleton; a null migratedAt on 'cloud-ready' still routes to Supabase");
{
  const localPolicy = selectDataRepositoryPolicy({ kind: "local", organizationId: "org-1", membershipId: "membership-1", migratedAt: null });
  check("2a: 'local' authority selects the shared dataRepository singleton (not a per-org instance)", localPolicy.repository === dataRepository);
  check("2b: 'local' authority does not block hydration", localPolicy.blockUntilHydrated === false);

  const cloudPolicy = selectDataRepositoryPolicy({ kind: "cloud-ready", organizationId: "org-1", membershipId: "membership-1", migratedAt: "2026-09-21T00:00:00.000Z" });
  check("2c: 'cloud-ready' (legacy_import, migrated) selects a real, dedicated SupabaseDataRepository", cloudPolicy.repository instanceof SupabaseDataRepository);
  check("2d: 'cloud-ready' (legacy_import, migrated) blocks hydration until the real cloud load completes", cloudPolicy.blockUntilHydrated === true);

  const cloudNativePolicy = selectDataRepositoryPolicy({ kind: "cloud-ready", organizationId: "org-3", membershipId: "membership-3", migratedAt: null });
  check(
    "2e: 'cloud-ready' with a null migratedAt (cloud_native) STILL selects Supabase, never falls back to local storage",
    cloudNativePolicy.repository instanceof SupabaseDataRepository && cloudNativePolicy.repository !== dataRepository,
  );
  check("2f: 'cloud-ready' with a null migratedAt still blocks hydration", cloudNativePolicy.blockUntilHydrated === true);
}

console.log("\n3. STRUCTURAL - LocalStorageDataRepository's key has no per-user/per-org namespacing (unchanged by Stage A/B; closed for cloud_native/migrated accounts because they never reach this repository at all - see section 2 above)");
{
  const repoSource = source("lib/data/localStorageRepository.ts");
  check(
    "3a: the storage key is a single global constant, not derived from any user/org/membership id",
    /const STORAGE_KEY = ["'`]falcon-deck:app-data:v1["'`]/.test(repoSource),
  );
  check(
    "3b: load() falls back to demo data only when storage is truly empty - otherwise returns whatever is already there, from ANY prior session on this origin",
    /if \(!stored\) return createDemoAppData\(\)/.test(repoSource),
  );
}

console.log("\n4. bootstrap_organization() explicitly writes account_origin='cloud_native' (Stage C) - and still never touches local_data_migrated_at");
{
  // Stage C's migration is a CREATE OR REPLACE FUNCTION of the original
  // from 20260914140000_bootstrap_organization.sql - this file is now the
  // authoritative source for the function's live INSERT statement.
  const rpcSource = source("supabase/migrations/20260922010000_bootstrap_organization_cloud_native.sql");
  const insertMatch = rpcSource.match(/insert into public\.organization_memberships[\s\S]*?returning id into v_membership_id;/);
  check("4a: found the Stage C membership INSERT statement to inspect", insertMatch !== null);
  check(
    "4b: the INSERT explicitly writes account_origin = 'cloud_native' - application intent stated in code, not left to Stage A's column default",
    insertMatch !== null &&
      /insert into public\.organization_memberships \([^)]*\baccount_origin\b[^)]*\)/.test(insertMatch[0]) &&
      /values \([^)]*'cloud_native'[^)]*\)/.test(insertMatch[0]),
  );
  check(
    "4c: the INSERT still never sets local_data_migrated_at - correct and permanent, per the approved design: it must never be fabricated for a cloud_native row, in Stage C or any later stage",
    insertMatch !== null && !insertMatch[0].includes("local_data_migrated_at"),
  );

  // The original, pre-Stage-C definition is retained purely as a historical
  // record - CREATE OR REPLACE FUNCTION means it no longer reflects the
  // function's live behavior, so it is not re-checked here as a source of
  // runtime truth.
  const originalRpcSource = source("supabase/migrations/20260914140000_bootstrap_organization.sql");
  check(
    "4d: the original migration file is untouched (Stage C is a separate CREATE OR REPLACE, not an edit to already-applied history)",
    originalRpcSource.includes("create function public.bootstrap_organization(organization_name text)") &&
      !originalRpcSource.includes("account_origin"),
  );
}

console.log("\n5. MigrationSetupCard's gate is an explicit migrationPending boolean, not a migratedAt timestamp check");
{
  const cardSource = source("components/onboarding/MigrationSetupCard.tsx");
  check("5a: the only early-return gate is `if (!migrationPending) return null;`", /if \(!migrationPending\) return null;/.test(cardSource));
  check(
    "5b: the props type declares migrationPending: boolean, and migratedAt never appears as an actual prop (only in the doc comment explaining why it's deliberately not one)",
    /migrationPending:\s*boolean;/.test(cardSource) && !/migratedAt\s*[,:]\s*(string|null)/.test(cardSource),
  );
  check(
    "5c: it never checks localStorage content/shape before deciding to render - it trusts the caller-supplied migrationPending alone",
    !/localStorage\s*[.[]/.test(cardSource),
  );

  const setupPageSource = source("app/(app)/setup/page.tsx");
  check(
    "5d: SetupPage computes migrationPending straight from authority.kind === \"local\" - no migratedAt extraction, no fabricated timestamp anywhere in the chain",
    /migrationPending = authority\.kind === ["']local["']/.test(setupPageSource) && !/authority\.migratedAt/.test(setupPageSource),
  );
}

console.log("\n6. RestoreBackupCard's ONLY gate is authorityKind === 'cloud-ready' - unchanged by Stage B, correct for both cloud_native and migrated legacy_import");
{
  const cardSource = source("components/onboarding/RestoreBackupCard.tsx");
  check("6a: the only branch point is `authorityKind === \"cloud-ready\"`", /authorityKind === ["']cloud-ready["']/.test(cardSource));
}

console.log("\n7. NavBar's 'Ogemaw Heights Falcons' hardcode - was a separate, cosmetic single-tenant leftover, explicitly out of scope for THIS (data-authority) fix; since fixed as its own later task - see scripts/verify-navbar-organization.ts");
{
  const navSource = source("components/layout/NavBar.tsx");
  check(
    "7a: NavBar no longer hardcodes 'Ogemaw Heights Falcons' - it now renders a resolved organizationName prop instead (fixed separately; full coverage in verify-navbar-organization.ts)",
    !navSource.includes("Ogemaw Heights Falcons") && /organizationName/.test(navSource),
  );
}

console.log("\n8. SCENARIO A (brand-new cloud_native account, as bootstrap_organization now explicitly produces post-Stage-C) - cloud-ready immediately, every legacy control hidden, NO fabricated migration timestamp");
{
  // The exact shape bootstrap_organization's Stage C INSERT now produces
  // for every new membership: account_origin='cloud_native', explicitly
  // written (section 4 above proves the INSERT states this itself, not
  // just Stage A's column default). local_data_migrated_at is left NULL,
  // as always - never a fabricated now() timestamp, in this stage or any
  // later one.

  const freshResolution: ActiveOrganizationResolution = {
    state: "resolved",
    membership: membership({ membershipId: "membership-new", organizationId: "org-new", accountOrigin: "cloud_native", localDataMigratedAt: null }),
  };
  const authority = deriveDataAuthorityState(freshResolution);
  check("8a: a freshly-bootstrapped cloud_native membership derives 'cloud-ready', never 'local'", authority.kind === "cloud-ready");
  check("8b: its migratedAt is null - genuinely no migration ever happened, and none was invented", authority.kind === "cloud-ready" && authority.migratedAt === null);

  const policy = selectDataRepositoryPolicy(authority);
  check("8c: it is routed to a real SupabaseDataRepository, never the shared localStorage singleton", policy.repository instanceof SupabaseDataRepository && policy.repository !== dataRepository);
  check("8d: hydration blocks until the real (empty) cloud load completes - no demo/local data can flash first", policy.blockUntilHydrated === true);

  check("8e: MigrationSetupCard's migrationPending (authority.kind === 'local') is false for this account - hidden", migrationPendingForSetupPage(authority) === false);
  const authorityKindForCard = authority.kind === "cloud-ready" ? "cloud-ready" : "local";
  check("8f: RestoreBackupCard's own gate (authorityKind === 'cloud-ready') would hide the local-restore UI for this account", authorityKindForCard === "cloud-ready");
}

console.log("\n9. SCENARIO B (legitimate legacy_import user still pending migration) - unaffected by the account_origin fix");
{
  // Shape of a genuine legacy Falcon Deck account before it migrates -
  // account_origin='legacy_import' set explicitly (by Stage A's backfill
  // or a future legacy-import action), local_data_migrated_at still null.
  const legacyResolution: ActiveOrganizationResolution = {
    state: "resolved",
    membership: membership({ membershipId: "membership-legacy", organizationId: "org-legacy", accountOrigin: "legacy_import", localDataMigratedAt: null }),
  };
  const authority = deriveDataAuthorityState(legacyResolution);
  check("9a: legacy_import + null timestamp still derives 'local'", authority.kind === "local");

  const policy = selectDataRepositoryPolicy(authority);
  check("9b: it is still routed to the local repository - the only path that can ever read/migrate their real local data", policy.repository === dataRepository);

  check("9c: MigrationSetupCard's migrationPending is true for this account - migration UI shown", migrationPendingForSetupPage(authority) === true);
  const authorityKindForCard = authority.kind === "cloud-ready" ? "cloud-ready" : "local";
  check("9d: RestoreBackupCard's gate still offers local restore for this legitimate legacy case", authorityKindForCard === "local");
}

console.log("\n10. SCENARIO C (a legacy_import user who has actually completed migration) - matches Ogemaw's real, verified production state (2026-09-22)");
{
  const migratedResolution: ActiveOrganizationResolution = {
    state: "resolved",
    membership: membership({ membershipId: "membership-migrated", organizationId: "org-migrated", accountOrigin: "legacy_import", localDataMigratedAt: "2026-09-20T15:30:00.000Z" }),
  };
  const authority = deriveDataAuthorityState(migratedResolution);
  check("10a: legacy_import + a real timestamp derives 'cloud-ready'", authority.kind === "cloud-ready");
  check("10b: the real timestamp passes through untouched", authority.kind === "cloud-ready" && authority.migratedAt === "2026-09-20T15:30:00.000Z");
  const policy = selectDataRepositoryPolicy(authority);
  check("10c: cloud repository is authoritative, not local storage", policy.repository instanceof SupabaseDataRepository);
  check("10d: migration controls are hidden post-migration", migrationPendingForSetupPage(authority) === false);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
