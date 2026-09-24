/**
 * Regression coverage for the second private-beta blocker: NavBar's
 * "OGEMAW HEIGHTS FALCONS" was a plain hardcoded string
 * (components/layout/NavBar.tsx), shown to every authenticated user
 * regardless of which organization they actually belong to - a genuine
 * single-tenant leftover, confirmed independently by the fresh-account
 * beta test (account-origin cutover fixed data authority; this is the
 * next, separate issue).
 *
 * FIX: NavBar now takes `organizationName` as a required prop and
 * renders it in place of the hardcoded string. The only caller,
 * app/(app)/layout.tsx, passes `resolution.membership.organizationName` -
 * a value that layout was already resolving via resolveActiveOrganization()
 * (lib/auth/dal.ts's getActiveMemberships, which joins organizations(name))
 * to decide whether to redirect and to derive DataAuthorityState. No new
 * query, client or server, was introduced to get this value.
 *
 * Deliberately unrelated to, and untouched by, this fix: the Falcon
 * Deck -> TeachDeck product rename, the Falcon Deck logo/wordmark itself,
 * account-origin/data-authority logic, onboarding behavior, and the
 * Supabase schema/migrations - see the task instructions this regression
 * coverage was written against.
 *
 *   npx tsx scripts/verify-navbar-organization.ts
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

console.log("1. NavBar no longer hardcodes an organization name");
{
  const navSource = source("components/layout/NavBar.tsx");
  check(
    "1a: the literal string 'Ogemaw Heights Falcons' (any casing) no longer appears anywhere in NavBar.tsx",
    !/ogemaw heights falcons/i.test(navSource),
  );
  check(
    "1b: NavBar's product name 'Falcon Deck' itself is untouched - this fix is not the product rebrand",
    navSource.includes("Falcon Deck"),
  );
}

console.log("\n2. NavBar renders a resolved organizationName prop, not a fallback/default string");
{
  const navSource = source("components/layout/NavBar.tsx");
  check(
    "2a: NavBar's signature declares organizationName: string as a required prop (no default, no `?`)",
    /export function NavBar\(\{ organizationName \}: \{ organizationName: string \}\)/.test(navSource),
  );
  check(
    "2b: the school-name span renders {organizationName} directly - no hardcoded literal alongside it",
    /uppercase tracking-widest text-falcon-gold-600">\s*\{organizationName\}\s*<\/span>/.test(navSource),
  );
}

console.log("\n3. app/(app)/layout.tsx sources organizationName from the already-resolved membership - no redundant query");
{
  const layoutSource = source("app/(app)/layout.tsx");
  check(
    "3a: NavBar is passed organizationName from resolution.membership - the same resolution this layout already computed for auth/authority",
    /<NavBar organizationName=\{resolution\.membership\.organizationName\} \/>/.test(layoutSource),
  );
  check(
    "3b: resolveActiveOrganization() (which resolves organizationName) is called exactly once in this file - proving no second/duplicate resolution was added for NavBar's sake",
    (layoutSource.match(/resolveActiveOrganization\(\)/g) ?? []).length === 1,
  );
  check(
    "3c: no new Supabase client construction was introduced in this layout to fetch the organization name separately",
    !/createSupabase(Server|Browser)Client/.test(layoutSource),
  );
}

console.log("\n4. resolveActiveOrganization's organizationName is a real, per-membership value - not a shared constant");
{
  const dalSource = source("lib/auth/dal.ts");
  check(
    "4a: ActiveMembership.organizationName is read from the organizations(name) join, per membership row - not a literal",
    /organizationName: organizationName \?\? "Unknown school"/.test(dalSource),
  );
}

console.log("\n5. demo/public routes remain unaffected - NavBar is only ever rendered from the authenticated (app) layout");
{
  const demoLayoutSource = source("app/demo/layout.tsx");
  const rootLayoutSource = source("app/layout.tsx");
  const presentLayoutSource = source("app/(presentation)/present/layout.tsx");
  check("5a: app/demo/layout.tsx never imports or renders NavBar", !demoLayoutSource.includes("NavBar"));
  check("5b: the public root layout (app/layout.tsx) never imports or renders NavBar", !rootLayoutSource.includes("NavBar"));
  check(
    "5c: the authenticated (presentation)/present layout deliberately renders no NavBar/app-shell chrome either (per its own doc comment)",
    !presentLayoutSource.includes("<NavBar"),
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
