/**
 * Offline verification of Phase A's repository-selection/hydration-safety
 * plumbing (docs: Falcon Deck V2 provider-cutover milestone). No network,
 * no Supabase project, no React renderer - pure functions only, run via
 * `tsx`:
 *
 *   npm run verify:cutover-provider
 *
 * What this deliberately does NOT cover: this repo has no React
 * component-rendering test harness (no jsdom/@testing-library), so actual
 * mount/remount/effect behavior and the /setup migration-prompt's rendered
 * output are not exercised end-to-end here. Two checks below (1 and 2) fall
 * back to the same static-source-inspection technique scripts/verify-demo.ts
 * already uses for structural properties a pure function call can't prove;
 * everything else tests the real pure logic these components are built on.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  dataAuthorityMountKey,
  deriveDataAuthorityState,
  type DataAuthorityState,
} from "@/lib/auth/dataAuthority";
import type { ActiveOrganizationResolution } from "@/lib/auth/dal";
import { selectDataRepositoryPolicy } from "@/lib/store/selectDataRepository";
import { dataRepository } from "@/lib/data/localStorageRepository";
import {
  canSave,
  hydrationReducer,
  shouldRenderChildren,
  shouldShowErrorScreen,
  shouldShowSessionEndedScreen,
  INITIAL_HYDRATION_STATE,
  type HydrationState,
} from "@/lib/store/hydrationState";
import { MIGRATION_ACTION_ENABLED, migrationUiReducer, INITIAL_MIGRATION_UI_STATE } from "@/lib/data/migration/migrationUiState";
import { buildLocalDataBackup } from "@/lib/data/migration/downloadBackup";
import { createDemoAppData } from "@/lib/data/demoData";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

// ---------------------------------------------------------------------------
// 1-2. Root layout stays auth-unaware; (app) layout is the one place that
// resolves authority. Static source checks - there's no pure function to
// call for "does this Server Component call cookies()/Supabase."
// ---------------------------------------------------------------------------
console.log("\n1-2. root layout vs. (app) layout - where authority resolution lives");

const rootLayoutSource = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
const appLayoutSource = readFileSync(join(process.cwd(), "app", "(app)", "layout.tsx"), "utf8");

check(
  "1. root layout (app/layout.tsx) does not import auth/authority resolution",
  !rootLayoutSource.includes('from "@/lib/auth/dal"') &&
    !rootLayoutSource.includes('from "@/lib/auth/dataAuthority"') &&
    !rootLayoutSource.includes('from "@/lib/store/CutoverAppDataProvider"'),
);
check(
  "1. root layout still mounts the plain, local AppDataProvider directly",
  rootLayoutSource.includes('from "@/lib/store/AppDataProvider"') && rootLayoutSource.includes("<AppDataProvider>"),
);
check(
  "2. the authenticated (app) layout resolves organization/membership and derives DataAuthorityState",
  appLayoutSource.includes("resolveActiveOrganization") && appLayoutSource.includes("deriveDataAuthorityState"),
);
check(
  "2. the authenticated (app) layout mounts CutoverAppDataProvider",
  appLayoutSource.includes("CutoverAppDataProvider"),
);

// ---------------------------------------------------------------------------
// 3-7. deriveDataAuthorityState: every resolveActiveOrganization() shape
// maps to its own, distinct DataAuthorityState.
// ---------------------------------------------------------------------------
console.log("\n3-7. deriveDataAuthorityState");

const unauthenticated: ActiveOrganizationResolution = { state: "unauthenticated" };
const none: ActiveOrganizationResolution = { state: "none" };
const needsSelection: ActiveOrganizationResolution = {
  state: "needs-selection",
  memberships: [
    { membershipId: "m-1", organizationId: "org-1", organizationName: "School A", role: "teacher", localDataMigratedAt: null },
    { membershipId: "m-2", organizationId: "org-2", organizationName: "School B", role: "teacher", localDataMigratedAt: null },
  ],
};
const resolvedUnmigrated: ActiveOrganizationResolution = {
  state: "resolved",
  membership: { membershipId: "m-1", organizationId: "org-1", organizationName: "School A", role: "teacher", localDataMigratedAt: null },
};
const resolvedMigrated: ActiveOrganizationResolution = {
  state: "resolved",
  membership: {
    membershipId: "m-1",
    organizationId: "org-1",
    organizationName: "School A",
    role: "teacher",
    localDataMigratedAt: "2026-09-16T00:00:00.000Z",
  },
};

check("3. unauthenticated -> anonymous", deriveDataAuthorityState(unauthenticated).kind === "anonymous");
check("4. zero memberships -> no-membership", deriveDataAuthorityState(none).kind === "no-membership");
check("5. needs-selection -> its OWN distinct kind, not folded into no-membership", deriveDataAuthorityState(needsSelection).kind === "needs-selection");
check("5. no-membership and needs-selection are different kinds", deriveDataAuthorityState(none).kind !== deriveDataAuthorityState(needsSelection).kind);
check("6. resolved + migratedAt null -> local", deriveDataAuthorityState(resolvedUnmigrated).kind === "local");
check("7. resolved + migratedAt set -> cloud-ready", deriveDataAuthorityState(resolvedMigrated).kind === "cloud-ready");

const localState = deriveDataAuthorityState(resolvedUnmigrated);
const cloudState = deriveDataAuthorityState(resolvedMigrated);
check(
  "6. local state carries organizationId/membershipId, migratedAt null",
  localState.kind === "local" && localState.organizationId === "org-1" && localState.membershipId === "m-1" && localState.migratedAt === null,
);
check(
  "7. cloud-ready state carries organizationId/membershipId and the real migratedAt timestamp",
  cloudState.kind === "cloud-ready" && cloudState.migratedAt === "2026-09-16T00:00:00.000Z",
);

// ---------------------------------------------------------------------------
// 8. Phase A repository selection - EVERY authority kind, including
// needs-selection and cloud-ready, must resolve to the local repository
// with blocking hydration off.
// ---------------------------------------------------------------------------
console.log("\n8. selectDataRepositoryPolicy (Phase A: always local + non-blocking, even when migrated)");

const anonymous: DataAuthorityState = { kind: "anonymous" };
const noMembership: DataAuthorityState = { kind: "no-membership" };
const needsSelectionAuthority: DataAuthorityState = { kind: "needs-selection" };
const local: DataAuthorityState = { kind: "local", organizationId: "org-1", membershipId: "m-1", migratedAt: null };
const cloudReady: DataAuthorityState = { kind: "cloud-ready", organizationId: "org-1", membershipId: "m-1", migratedAt: "2026-09-16T00:00:00.000Z" };

for (const [label, authority] of [
  ["anonymous", anonymous],
  ["no-membership", noMembership],
  ["needs-selection", needsSelectionAuthority],
  ["local (unmigrated)", local],
  ["cloud-ready (migrated)", cloudReady],
] as const) {
  const policy = selectDataRepositoryPolicy(authority);
  check(`8. ${label} -> LocalStorageDataRepository`, policy.repository === dataRepository);
  check(`8. ${label} -> blockUntilHydrated is false in Phase A`, policy.blockUntilHydrated === false);
}

// ---------------------------------------------------------------------------
// 9-10. authority identity -> mount key (the mechanism CutoverAppDataProvider
// uses to force a fresh AppDataProvider mount).
// ---------------------------------------------------------------------------
console.log("\n9-10. dataAuthorityMountKey (forces a fresh AppDataProvider mount on identity change)");

check("anonymous and no-membership have distinct keys", dataAuthorityMountKey(anonymous) !== dataAuthorityMountKey(noMembership));
check(
  "9. needs-selection has its own distinct mount identity, not shared with no-membership or anonymous",
  dataAuthorityMountKey(needsSelectionAuthority) !== dataAuthorityMountKey(noMembership) &&
    dataAuthorityMountKey(needsSelectionAuthority) !== dataAuthorityMountKey(anonymous),
);
check(
  "10. local and cloud-ready for the SAME membership still cause different mount identities",
  dataAuthorityMountKey(local) !== dataAuthorityMountKey(cloudReady),
);
check(
  "two different resolved memberships get different mount keys",
  dataAuthorityMountKey(local) !== dataAuthorityMountKey({ kind: "local", organizationId: "org-2", membershipId: "m-2", migratedAt: null }),
);
check(
  "the SAME authority produces the SAME key (no spurious remounts)",
  dataAuthorityMountKey(local) === dataAuthorityMountKey({ kind: "local", organizationId: "org-1", membershipId: "m-1", migratedAt: null }),
);

// ---------------------------------------------------------------------------
// 11-14. hydration render policy: shouldRenderChildren/shouldShowErrorScreen
// are exactly what AppDataProvider's render body calls - testing them here
// tests the real decision, not a re-implementation of it.
// ---------------------------------------------------------------------------
console.log("\n11-14. hydration render policy (shouldRenderChildren / shouldShowErrorScreen)");

const loading: HydrationState = { status: "loading" };
const ready: HydrationState = { status: "ready" };
const errored: HydrationState = { status: "error", message: "network down" };

check(
  "11. local hydration (blockUntilHydrated=false) retains today's immediate-render behavior while loading",
  shouldRenderChildren(false, loading) === true,
);
check(
  "12. blocking hydration (blockUntilHydrated=true) does NOT expose children while loading",
  shouldRenderChildren(true, loading) === false,
);
check(
  "13. blocking hydration renders children once LOAD_SUCCESS is reached (ready)",
  shouldRenderChildren(true, ready) === true,
);
check(
  "14. blocking hydration load failure shows Retry (shouldShowErrorScreen) and never renders children",
  shouldShowErrorScreen(errored) === true && shouldRenderChildren(true, errored) === false,
);
check(
  "14. a load failure blocks children even in non-blocking (local) mode too - error always wins",
  shouldRenderChildren(false, errored) === false,
);

// ---------------------------------------------------------------------------
// 15-17. save gating and retry recovery.
// ---------------------------------------------------------------------------
console.log("\n15-17. canSave / retry recovery");

check("initial state is loading", INITIAL_HYDRATION_STATE.status === "loading");
check("15. save cannot run while loading", canSave(loading) === false);
check("16. save cannot run after failed hydration", canSave(errored) === false);
check(
  "17. retry (LOAD_START) from an error state returns to loading, then LOAD_SUCCESS recovers to a saveable ready state",
  (() => {
    const retrying = hydrationReducer(errored, { type: "LOAD_START" });
    const recovered = hydrationReducer(retrying, { type: "LOAD_SUCCESS" });
    return retrying.status === "loading" && recovered.status === "ready" && canSave(recovered);
  })(),
);
check(
  "a successful load reaches a saveable ready state directly too",
  (() => {
    const succeeded = hydrationReducer(INITIAL_HYDRATION_STATE, { type: "LOAD_SUCCESS" });
    return succeeded.status === "ready" && canSave(succeeded);
  })(),
);
check(
  "LOAD_FAILURE carries the actual error message through to the blocking UI",
  hydrationReducer(loading, { type: "LOAD_FAILURE", message: "network down" }).status === "error" &&
    (hydrationReducer(loading, { type: "LOAD_FAILURE", message: "network down" }) as { message: string }).message === "network down",
);

// ---------------------------------------------------------------------------
// 18-19. /setup migration UX plumbing.
// ---------------------------------------------------------------------------
console.log("\n18-19. migrationUiState (Phase A plumbing only)");

check("18. MIGRATION_ACTION_ENABLED is false in Phase A", MIGRATION_ACTION_ENABLED === false);
check(
  "downloading a backup transitions the UI state without touching migration progress",
  migrationUiReducer(INITIAL_MIGRATION_UI_STATE, { type: "BACKUP_DOWNLOADED" }).step === "backup-downloaded",
);
check(
  "19. buildLocalDataBackup uses the CURRENT AppData and does not mutate it",
  (() => {
    const original = createDemoAppData();
    const beforeJson = JSON.stringify(original);
    const backup = buildLocalDataBackup(original);
    const unchanged = JSON.stringify(original) === beforeJson;
    const backupIsIndependent = backup.appData !== original; // structuredClone, not the same reference
    original.courses.push({ id: "mutate-after-backup", name: "Should not appear in backup" });
    const backupUnaffectedByLaterMutation = !backup.appData.courses.some((c) => c.id === "mutate-after-backup");
    return unchanged && backupIsIndependent && backupUnaffectedByLaterMutation;
  })(),
);

// ---------------------------------------------------------------------------
// 20-29 (Present Mode + Supabase authority audit's required tests 1-10):
// the authenticated /present route group, and that Present's own component
// tree and Demo are untouched by this change.
// ---------------------------------------------------------------------------
console.log("\n20-29. authenticated /present route group (Present Mode + Supabase authority audit)");

const presentPageNewPath = join(process.cwd(), "app", "(presentation)", "present", "page.tsx");
const presentLayoutPath = join(process.cwd(), "app", "(presentation)", "present", "layout.tsx");
const presentPageOldPath = join(process.cwd(), "app", "present", "page.tsx");

check("1. /present now exists inside the authenticated (presentation) route group", existsSync(presentPageNewPath));
check("2. /present no longer exists at the old app/present/page.tsx path", !existsSync(presentPageOldPath));

const presentLayoutSource = readFileSync(presentLayoutPath, "utf8");
check(
  "3. the /present layout requires authentication (reuses requireAuthenticatedUser, doesn't reimplement it)",
  presentLayoutSource.includes("requireAuthenticatedUser") &&
    presentLayoutSource.includes('from "@/lib/auth/dal"'),
);
check(
  "3. the /present layout resolves organization/membership and derives DataAuthorityState, same as (app)",
  presentLayoutSource.includes("resolveActiveOrganization") && presentLayoutSource.includes("deriveDataAuthorityState"),
);
check("the /present layout mounts CutoverAppDataProvider", presentLayoutSource.includes("CutoverAppDataProvider"));
check(
  "the /present layout renders children WITHOUT NavBar/app-shell chrome (unlike (app)/layout.tsx)",
  !presentLayoutSource.includes('from "@/components/layout/NavBar"') &&
    !presentLayoutSource.includes("<NavBar") &&
    !presentLayoutSource.includes("max-w-6xl"),
);
check(
  "6. requireAuthenticatedUser() is called BEFORE CutoverAppDataProvider is ever mounted - an anonymous request " +
    "redirects away and never reaches a mounted provider (local or otherwise) as Present's operative authority",
  presentLayoutSource.indexOf("requireAuthenticatedUser") < presentLayoutSource.indexOf("<CutoverAppDataProvider"),
);

const presentPageSource = readFileSync(presentPageNewPath, "utf8");
check("8. the moved /present page still imports PresentScreen (content is otherwise untouched)", presentPageSource.includes("PresentScreen"));

const demoPresentPagePath = join(process.cwd(), "app", "demo", "present", "page.tsx");
const demoLayoutPath = join(process.cwd(), "app", "demo", "layout.tsx");
check("7. /demo/present still exists, untouched", existsSync(demoPresentPagePath));
const demoLayoutSource = readFileSync(demoLayoutPath, "utf8");
check(
  "7. /demo's layout has no auth/authority coupling - it stays on its own isolated DemoAppDataProvider",
  !demoLayoutSource.includes('from "@/lib/auth/dal"') && !demoLayoutSource.includes("CutoverAppDataProvider"),
);

// Tests 8 (PresentScreen data APIs unchanged) and 10 (no components/present/*
// files modified) are git-status facts, not something a pure function call
// can prove - same rationale as tests 1-2's static source inspection above.
try {
  const presentComponentDiff = execFileSync("git", ["diff", "--name-only", "--", "components/present"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  check(
    "8 & 10. no components/present/* files were modified by this change (PresentScreen's data APIs are exactly as they were)",
    presentComponentDiff === "",
  );
} catch {
  check("8 & 10. no components/present/* files were modified by this change (git diff check)", false);
}

const presentComponentFiles = [
  "components/present/PresentScreen.tsx",
  "components/present/PreviewPresentScreen.tsx",
  "components/present/LivePresentScreen.tsx",
];
check(
  "9. no direct localStorage use exists in Present's screen components",
  presentComponentFiles
    .filter((path) => existsSync(join(process.cwd(), path)))
    .every((path) => !readFileSync(join(process.cwd(), path), "utf8").includes("localStorage")),
);

// ---------------------------------------------------------------------------
// 30-33. HydrationSessionEnded - pure state logic only, per the Present
// Mode + Supabase authority audit's "AUTH EVENT DESIGN - AUDIT/TEST ONLY"
// requirement. NOT wired into any runtime repository or AppDataProvider
// dispatch site yet - these checks prove the logic is correct and ready,
// not that anything currently produces this state.
// ---------------------------------------------------------------------------
console.log("\n30-33. HydrationSessionEnded (pure logic only - not wired to any runtime repository yet)");

const sessionEnded: HydrationState = hydrationReducer(loading, { type: "SESSION_ENDED" });
check("SESSION_ENDED transitions to a distinct session-ended status, not a generic error", sessionEnded.status === "session-ended");
check("a session-ended state is recognized by shouldShowSessionEndedScreen, not shouldShowErrorScreen", shouldShowSessionEndedScreen(sessionEnded) && !shouldShowErrorScreen(sessionEnded));
check("a session-ended state always blocks children, in both blocking and non-blocking modes", !shouldRenderChildren(true, sessionEnded) && !shouldRenderChildren(false, sessionEnded));
check("a session-ended state can never save (same guarantee as error/loading)", canSave(sessionEnded) === false);

// ---------------------------------------------------------------------------
// 34. Sign-out scope: the production route must scope signOut() to this
// device ("local"), never Supabase's unscoped/global default - Falcon Deck
// is explicitly designed for one teacher across multiple devices (home +
// school), and a home sign-out must never revoke the school session (or
// vice versa). Static source check - which scope string is actually passed
// to signOut() isn't something a pure function call can prove.
// ---------------------------------------------------------------------------
console.log("\n34. sign-out scope (home/school multi-device correctness)");

const signOutRouteSource = readFileSync(join(process.cwd(), "app", "auth", "signout", "route.ts"), "utf8");
check(
  'the production sign-out route explicitly scopes to this device (supabase.auth.signOut({ scope: "local" }))',
  /supabase\.auth\.signOut\(\s*\{\s*scope:\s*["']local["']\s*\}\s*\)/.test(signOutRouteSource),
);
check(
  "the production sign-out route never calls an unscoped/global supabase.auth.signOut()",
  !/supabase\.auth\.signOut\(\s*\)/.test(signOutRouteSource),
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
console.log(
  "\nNote: this repo has no React component-rendering test harness (no jsdom/@testing-library). /setup's rendered " +
    "migration-prompt visibility for unmigrated vs. migrated memberships, and demo/login/onboarding regression, are " +
    "verified by code inspection instead: MigrationSetupCard's `if (migratedAt !== null) return null;` guard, and " +
    "confirmation that app/demo/layout.tsx's isolated DemoAppDataProvider, app/login/page.tsx, and " +
    "app/onboarding/page.tsx are untouched by this milestone's changes.",
);
process.exit(failures === 0 ? 0 : 1);
