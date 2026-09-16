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

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
console.log(
  "\nNote: this repo has no React component-rendering test harness (no jsdom/@testing-library). /setup's rendered " +
    "migration-prompt visibility for unmigrated vs. migrated memberships, and demo/login/onboarding regression, are " +
    "verified by code inspection instead: MigrationSetupCard's `if (migratedAt !== null) return null;` guard, and " +
    "confirmation that app/demo/layout.tsx's isolated DemoAppDataProvider, app/login/page.tsx, and " +
    "app/onboarding/page.tsx are untouched by this milestone's changes.",
);
process.exit(failures === 0 ? 0 : 1);
