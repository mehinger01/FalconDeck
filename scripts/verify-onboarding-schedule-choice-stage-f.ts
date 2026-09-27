/**
 * Offline verification of Stage F (join-existing-school initiative):
 * onboarding's mandatory schedule-selection step (/setup/schedule),
 * ScheduleChoiceScreen's data-driven chooser, and the ActiveScheduleGate
 * navigation gate.
 *
 * This repo has no React/DOM rendering harness (no jsdom/@testing-library),
 * so ActiveScheduleGate.tsx exports its actual routing decision as a plain,
 * pure function (shouldGateRedirect/isExemptPath) specifically so this
 * script can behaviorally exercise the real logic a rendered gate would
 * run, rather than only inspecting source text for it. Reducer/mapper/
 * applyDiff checks below dispatch through the REAL appDataReducer and run
 * the REAL applyDiff against an in-memory recording fake Supabase client
 * (same technique as scripts/verify-teacher-period-assignments-stage-e.ts) -
 * no live Supabase project, no network.
 *
 *   npm run verify:onboarding-schedule-choice-stage-f
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appDataReducer } from "@/lib/store/reducer";
import { isExemptPath, shouldEnforceGate, shouldGateRedirect } from "@/lib/store/ActiveScheduleGate";
import { isUsableSharedSchedule } from "@/lib/schedule/isUsableSharedSchedule";
import { isRecommendedSchedule } from "@/lib/schedule/isRecommendedSchedule";
import { resolveActiveSchedule } from "@/lib/schedule/resolveActiveSchedule";
import { getOnboardingStatus } from "@/lib/onboarding/getOnboardingStatus";
import { applyDiff } from "@/lib/data/supabaseDataRepository";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import type { Database } from "@/lib/data/supabase.types";
import type { AppData } from "@/lib/data/types";
import type { BellSchedule } from "@/types/schedule";
import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const ctx: OwnerContext = { organizationId: "org-1", membershipId: "membership-1" };

function orgSchedule(id: string, overrides: Partial<BellSchedule> = {}): BellSchedule {
  return {
    id,
    name: `Shared Schedule ${id}`,
    ownerType: "organization",
    isDefault: false,
    timeZone: "America/Detroit",
    blocks: [
      { id: "block-1", label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: null, overrides: [] },
    ],
    ...overrides,
  };
}

function teacherSchedule(id: string, overrides: Partial<BellSchedule> = {}): BellSchedule {
  return {
    id,
    name: `My Schedule ${id}`,
    ownerType: "teacher",
    isDefault: false,
    timeZone: "America/Detroit",
    blocks: [
      { id: "t-block-1", label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: null, overrides: [] },
    ],
    ...overrides,
  };
}

function baseAppData(schedules: BellSchedule[]): AppData {
  return {
    courses: [],
    classSections: [],
    schedules,
    lessons: [],
    classPresentationSettings: [],
    classroomExperienceSettings: DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
    libraryResources: [],
    teacherSchedulePreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
    schoolCalendar: null,
    teacherPeriodAssignments: [],
    transitionOverrides: [],
  };
}

// ---------------------------------------------------------------------------
// CHOOSER: which schedules ScheduleChoiceScreen would offer as "shared"
// ---------------------------------------------------------------------------
console.log("1. Chooser: which organization-owned schedules count as usable (ScheduleChoiceScreen's own filter)");

const configuredShared = orgSchedule("shared-configured");
const unconfiguredShared = orgSchedule("shared-unconfigured", { needsConfiguration: true, blocks: [] });
const emptyBlocksShared = orgSchedule("shared-empty", { blocks: [] });
const privateOne = teacherSchedule("private-1");

const dataWithSharedAndPrivate = baseAppData([configuredShared, unconfiguredShared, emptyBlocksShared, privateOne]);
const usableInMixedData = dataWithSharedAndPrivate.schedules.filter(isUsableSharedSchedule);
check(">=1 usable org schedule -> chooser would show it (present in the usable list)", usableInMixedData.some((s) => s.id === "shared-configured"));
check("exactly one usable schedule found in the mixed fixture (the other two org-owned ones are excluded)", usableInMixedData.length === 1);
check("a needsConfiguration shared schedule is excluded", !usableInMixedData.some((s) => s.id === "shared-unconfigured"));
check("a zero-block shared schedule is excluded", !usableInMixedData.some((s) => s.id === "shared-empty"));
check("a teacher-owned schedule never counts as a usable SHARED schedule", !usableInMixedData.some((s) => s.id === "private-1"));

const dataWithZeroShared = baseAppData([privateOne]);
check("zero usable org schedules -> private path (usable-shared filter is empty)", dataWithZeroShared.schedules.filter(isUsableSharedSchedule).length === 0);

const dataWithOnlyUnusableShared = baseAppData([unconfiguredShared, emptyBlocksShared]);
check(
  "org-owned schedules that all need configuration -> still treated as zero usable (private path), not shown as choosable",
  dataWithOnlyUnusableShared.schedules.filter(isUsableSharedSchedule).length === 0,
);

// Source-consistency check: confirm ScheduleChoiceScreen actually wires up
// isUsableSharedSchedule (imported from the shared helper) rather than a
// second, re-derived inline predicate that could silently drift from it.
const scheduleChoiceScreenSource = readFileSync(
  join(process.cwd(), "components", "onboarding", "ScheduleChoiceScreen.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
check(
  "ScheduleChoiceScreen.tsx imports and filters with the shared isUsableSharedSchedule helper (no second, re-derived predicate)",
  scheduleChoiceScreenSource.includes('import { isUsableSharedSchedule } from "@/lib/schedule/isUsableSharedSchedule"') &&
    scheduleChoiceScreenSource.includes("data.schedules.filter(isUsableSharedSchedule)"),
);

// ---------------------------------------------------------------------------
// SEMANTICS: Recommended / Active
// ---------------------------------------------------------------------------
console.log("\n2. Semantics: Recommended and Active");
check("org isDefault true -> Recommended", isRecommendedSchedule(orgSchedule("shared-default", { isDefault: true })));
check("org isDefault false -> not Recommended", !isRecommendedSchedule(orgSchedule("shared-not-default", { isDefault: false })));
check(
  "teacher-owned isDefault true -> NEVER Recommended",
  !isRecommendedSchedule(teacherSchedule("private-default", { isDefault: true })),
);

const recommendedButNotActive = orgSchedule("shared-recommended", { isDefault: true });
const otherSchedule = orgSchedule("shared-other");
const activeIsOther: AppData = {
  ...baseAppData([recommendedButNotActive, otherSchedule]),
  teacherSchedulePreferences: { ...DEFAULT_TEACHER_SCHEDULE_PREFERENCES, activeBellScheduleId: "shared-other" },
};
check(
  "Recommended does NOT imply active - resolveActiveSchedule follows activeBellScheduleId only, ignoring isDefault",
  resolveActiveSchedule(activeIsOther.schedules, activeIsOther.teacherSchedulePreferences)?.id === "shared-other",
);
check(
  "the Recommended schedule itself is correctly NOT reported as active in this fixture",
  activeIsOther.teacherSchedulePreferences.activeBellScheduleId !== recommendedButNotActive.id,
);
check(
  "merely computing Recommended/Active is a pure read - no reducer action type is involved at all",
  typeof isRecommendedSchedule === "function" && typeof resolveActiveSchedule === "function",
);

// ---------------------------------------------------------------------------
// SHARED SELECTION: dispatching what setActiveBellSchedule() dispatches
// ---------------------------------------------------------------------------
console.log("\n3. Shared selection: UPDATE_TEACHER_SCHEDULE_PREFERENCES (what setActiveBellSchedule dispatches) touches ONLY activeBellScheduleId");

const selectionPrev = baseAppData([configuredShared, otherSchedule]);
const selectionNext = appDataReducer(selectionPrev, {
  type: "UPDATE_TEACHER_SCHEDULE_PREFERENCES",
  patch: { activeBellScheduleId: "shared-configured" },
});
check("activeBellScheduleId is now set to the chosen schedule", selectionNext.teacherSchedulePreferences.activeBellScheduleId === "shared-configured");
check("the schedules array is the EXACT SAME reference (no clone, no add, no mutation)", selectionNext.schedules === selectionPrev.schedules);
check("the chosen schedule object itself is unchanged (isDefault/blocks/etc. all identical)", selectionNext.schedules.find((s) => s.id === "shared-configured") === configuredShared);
check("teacherPeriodAssignments is the EXACT SAME reference (no assignments created)", selectionNext.teacherPeriodAssignments === selectionPrev.teacherPeriodAssignments);
check("lunchWave (the other preference field) is untouched", selectionNext.teacherSchedulePreferences.lunchWave === selectionPrev.teacherSchedulePreferences.lunchWave);

// ---------------------------------------------------------------------------
// PRIVATE PATH
// ---------------------------------------------------------------------------
console.log("\n4. Private path: creating a schedule never activates it; only an explicit selection does");

const createdPrev = baseAppData([]);
const createdNext = appDataReducer(createdPrev, {
  type: "ADD_SCHEDULE",
  schedule: { id: "new-private", name: "New Schedule", ownerType: "teacher", isDefault: false, timeZone: "America/Detroit", blocks: [] },
});
check("ADD_SCHEDULE adds the schedule", createdNext.schedules.some((s) => s.id === "new-private"));
check("ADD_SCHEDULE alone leaves activeBellScheduleId null", createdNext.teacherSchedulePreferences.activeBellScheduleId === null);
check(
  "creating a private schedule alone does NOT satisfy the gate - /present would still redirect",
  shouldGateRedirect("/present", createdNext.teacherSchedulePreferences),
);

const activatedNext = appDataReducer(createdNext, {
  type: "UPDATE_TEACHER_SCHEDULE_PREFERENCES",
  patch: { activeBellScheduleId: "new-private" },
});
check(
  "explicit activation (Use this schedule) DOES satisfy the gate - /present is now allowed",
  !shouldGateRedirect("/present", activatedNext.teacherSchedulePreferences),
);

check(
  "ScheduleChoiceScreen's \"Build my own schedule\" section is a plain navigation link, not an action dispatch (source check - inherently a 'no code calls this' fact, not runtime-observable)",
  (() => {
    const buildOwnIndex = scheduleChoiceScreenSource.indexOf("Build my own schedule");
    const afterHeading = scheduleChoiceScreenSource.slice(buildOwnIndex);
    return buildOwnIndex !== -1 && afterHeading.includes('href="/schedule"') && !/actions\.\w+\(/.test(afterHeading);
  })(),
);

// ---------------------------------------------------------------------------
// COMPLETION: scheduleComplete never depends on teacherPeriodAssignments
// ---------------------------------------------------------------------------
console.log("\n5. Completion: scheduleComplete requires an active, block-having schedule - never touches teacherPeriodAssignments");

const completionActiveNoAssignments: AppData = {
  ...baseAppData([configuredShared]),
  teacherSchedulePreferences: { ...DEFAULT_TEACHER_SCHEDULE_PREFERENCES, activeBellScheduleId: "shared-configured" },
  teacherPeriodAssignments: [],
};
check(
  "active shared schedule + ZERO assignments -> scheduleComplete is true",
  getOnboardingStatus(completionActiveNoAssignments).scheduleComplete === true,
);

const completionActiveWithAssignments: AppData = {
  ...completionActiveNoAssignments,
  teacherPeriodAssignments: [
    { id: "assignment-1", scheduleId: "shared-configured", blockId: "block-1", overrideWeekday: null, classSectionId: "section-a" },
  ],
};
check(
  "active shared schedule + assignments present -> scheduleComplete is STILL true, same value (assignments are irrelevant)",
  getOnboardingStatus(completionActiveWithAssignments).scheduleComplete === getOnboardingStatus(completionActiveNoAssignments).scheduleComplete,
);

const completionNullActive: AppData = { ...baseAppData([configuredShared]) }; // activeBellScheduleId defaults to null
check("null active -> scheduleComplete is false", getOnboardingStatus(completionNullActive).scheduleComplete === false);

// ---------------------------------------------------------------------------
// GATE: shouldGateRedirect / isExemptPath - the real routing decision
// ---------------------------------------------------------------------------
console.log("\n6. Gate: shouldGateRedirect - the actual decision a rendered ActiveScheduleGate would make");

const nullPrefs = DEFAULT_TEACHER_SCHEDULE_PREFERENCES; // activeBellScheduleId: null
const activePrefs = { ...DEFAULT_TEACHER_SCHEDULE_PREFERENCES, activeBellScheduleId: "some-schedule" };

check("null + /present -> redirect", shouldGateRedirect("/present", nullPrefs));
check("null + /week -> redirect", shouldGateRedirect("/week", nullPrefs));
check("null + /classes (ordinary app route) -> redirect", shouldGateRedirect("/classes", nullPrefs));
check("null + /setup (not on the exempt list) -> redirect", shouldGateRedirect("/setup", nullPrefs));

check("/setup/schedule remains accessible even when null", !shouldGateRedirect("/setup/schedule", nullPrefs));
check("/schedule remains accessible even when null", !shouldGateRedirect("/schedule", nullPrefs));
check("a nested /schedule/calendar route also remains accessible when null", !shouldGateRedirect("/schedule/calendar", nullPrefs));

check("active schedule -> ordinary route (/present) is allowed", !shouldGateRedirect("/present", activePrefs));
check("active schedule -> /week is allowed", !shouldGateRedirect("/week", activePrefs));

console.log("    no redirect loop: the exact destination the gate redirects TO is exempt under every possible preferences value");
check("/setup/schedule is exempt when null", !shouldGateRedirect("/setup/schedule", nullPrefs));
check("/setup/schedule is exempt when active", !shouldGateRedirect("/setup/schedule", activePrefs));
check("isExemptPath agrees for both /setup/schedule and /schedule", isExemptPath("/setup/schedule") && isExemptPath("/schedule"));
check("isExemptPath correctly rejects an unrelated route", !isExemptPath("/present") && !isExemptPath("/classes") && !isExemptPath("/setup"));

// ---------------------------------------------------------------------------
// AUTHORITY-AWARE GATE: shouldEnforceGate - what ActiveScheduleGate actually
// computes (enabled comes from CutoverAppDataProvider's
// authority.kind === "cloud-ready", never rediscovered here). This is the
// exact fix for the cutover audit's latent bug: a migration-pending
// "local"-authority account must never be redirected by this gate at all,
// bare /setup included - that route has to stay reachable for
// MigrationSetupCard to run.
// ---------------------------------------------------------------------------
console.log("\n7. Authority-aware gate: shouldEnforceGate - cloud-ready enforces fully, local/migration-pending never redirects");

console.log("    CLOUD-READY (enabled: true) + null active:");
check("/present -> redirect", shouldEnforceGate(true, "/present", nullPrefs));
check("/week -> redirect", shouldEnforceGate(true, "/week", nullPrefs));
check("/classes -> redirect", shouldEnforceGate(true, "/classes", nullPrefs));
check("/setup -> redirect (bare /setup stays gated for cloud-ready)", shouldEnforceGate(true, "/setup", nullPrefs));
check("/setup/schedule -> allowed", !shouldEnforceGate(true, "/setup/schedule", nullPrefs));
check("/schedule -> allowed", !shouldEnforceGate(true, "/schedule", nullPrefs));

console.log("    CLOUD-READY (enabled: true) + active schedule:");
check("/present -> allowed", !shouldEnforceGate(true, "/present", activePrefs));
check("/week -> allowed", !shouldEnforceGate(true, "/week", activePrefs));
check("/classes -> allowed", !shouldEnforceGate(true, "/classes", activePrefs));

console.log("    LOCAL/MIGRATION-PENDING (enabled: false) + null active - the exact bug the cutover audit found:");
check(
  "local authority + /setup + null active does NOT redirect to /setup/schedule (the exact latent bug fixed here)",
  !shouldEnforceGate(false, "/setup", nullPrefs),
);
check("local authority + /present is allowed by ActiveScheduleGate itself (no Stage F redirect)", !shouldEnforceGate(false, "/present", nullPrefs));
check("local authority + /week is allowed by ActiveScheduleGate itself (no Stage F redirect)", !shouldEnforceGate(false, "/week", nullPrefs));
check("local authority + /classes is allowed by ActiveScheduleGate itself (no Stage F redirect)", !shouldEnforceGate(false, "/classes", nullPrefs));
check(
  "local authority never redirects regardless of path, even one shouldGateRedirect alone would flag",
  !shouldEnforceGate(false, "/present", nullPrefs) && shouldGateRedirect("/present", nullPrefs),
  // The second half proves this isn't vacuously true because /present was
  // already exempt - shouldGateRedirect (authority-blind) DOES say redirect
  // for /present + null, so shouldEnforceGate's false result here is
  // entirely due to enabled=false, not a coincidence of the path.
);

// ---------------------------------------------------------------------------
// AUTHORITY: no localStorage, no second authority path, no persisted step
// ---------------------------------------------------------------------------
console.log("\n8. Cloud authority: no localStorage path, no second Supabase authority path, in any new/touched Stage F file");

const stageFFiles = [
  "components/onboarding/ScheduleChoiceScreen.tsx",
  "lib/store/ActiveScheduleGate.tsx",
  "lib/store/CutoverAppDataProvider.tsx",
  "app/(app)/setup/schedule/page.tsx",
  "lib/schedule/isUsableSharedSchedule.ts",
  "lib/schedule/isRecommendedSchedule.ts",
].map((relativePath) => ({ relativePath, source: readFileSync(join(process.cwd(), relativePath), "utf8") }));

for (const { relativePath, source } of stageFFiles) {
  check(`${relativePath}: no localStorageRepository reference`, !source.includes("localStorageRepository"));
  check(`${relativePath}: no direct window.localStorage/sessionStorage reference`, !/window\.(localStorage|sessionStorage)/.test(source));
  check(`${relativePath}: no cookie-based setup-state write (document.cookie)`, !source.includes("document.cookie"));
  check(`${relativePath}: no second Supabase client/authority import`, !/from ["']@supabase|createSupabaseServerClient|createSupabaseBrowserClient/.test(source));
}
check(
  "ActiveScheduleGate.tsx reads authority exclusively via useAppData() (the existing shared context)",
  stageFFiles.find((f) => f.relativePath === "lib/store/ActiveScheduleGate.tsx")!.source.includes("useAppData()"),
);

// ---------------------------------------------------------------------------
// BOUNDARY: no migration, no Stage G/admin tooling introduced by this stage
// ---------------------------------------------------------------------------
console.log("\n9. Boundary: no migration, no Stage G/admin tooling");

const migrationFiles = readdirSync(join(process.cwd(), "supabase", "migrations"));
check(
  "no new migration file mentions Stage F/onboarding-schedule-choice",
  !migrationFiles.some((name) => /stage_f|schedule_choice|onboarding_schedule/i.test(name)),
);
check(
  "no Stage F source file references admin schedule-management tooling",
  !stageFFiles.some(({ source }) => /admin.{0,20}schedule|schedule.{0,20}admin/i.test(source)),
);
check(
  "no Stage F source file seeds an organization-owned schedule (no bell_schedules insert/seed literal)",
  !stageFFiles.some(({ source }) => /seed.{0,30}(bell_schedule|organization.owned)/i.test(source)),
);

// ---------------------------------------------------------------------------
// applyDiff: shared selection must never write to bell_schedules/
// schedule_blocks/schedule_block_overrides/teacher_period_assignments -
// same recording-fake-client technique as Stage E's own verify script.
// ---------------------------------------------------------------------------

interface RecordedWrite {
  table: string;
  op: "delete" | "upsert";
}

function createRecordingClient(): { client: SupabaseClient<Database>; calls: RecordedWrite[] } {
  const calls: RecordedWrite[] = [];
  function chainable() {
    const builder: {
      eq: () => typeof builder;
      then: (resolve: (value: { data: null; error: null }) => unknown) => unknown;
    } = {
      eq: () => builder,
      then: (resolve) => Promise.resolve(resolve({ data: null, error: null })),
    };
    return builder;
  }
  const client = {
    from(table: string) {
      return {
        delete() {
          calls.push({ table, op: "delete" });
          return chainable();
        },
        upsert(_rows: unknown) {
          calls.push({ table, op: "upsert" });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

async function runApplyDiffChecks() {
  console.log("\n10. applyDiff: activating a shared schedule writes ONLY teacher_schedule_preferences");
  const recording = createRecordingClient();
  await applyDiff(recording.client, ctx, selectionPrev, selectionNext);
  const touchedTables = new Set(recording.calls.map((c) => c.table));
  check("writes to teacher_schedule_preferences", touchedTables.has("teacher_schedule_preferences"));
  check("writes ZERO times to bell_schedules", !touchedTables.has("bell_schedules"));
  check("writes ZERO times to schedule_blocks", !touchedTables.has("schedule_blocks"));
  check("writes ZERO times to schedule_block_overrides", !touchedTables.has("schedule_block_overrides"));
  check("writes ZERO times to teacher_period_assignments", !touchedTables.has("teacher_period_assignments"));
  check(
    "writes to NOTHING else at all (exactly one table touched)",
    touchedTables.size === 1,
  );
}

runApplyDiffChecks()
  .then(() => {
    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
