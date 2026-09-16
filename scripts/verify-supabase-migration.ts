/**
 * LIVE integration tests against the real linked Supabase project, using
 * two PERSISTENT, dedicated, already-confirmed test accounts (never a real
 * Falcon Deck user's account). Designed to be rerun repeatedly without
 * consuming Supabase's email-signup quota each time - these accounts are
 * created and confirmed once, out-of-band, and reused across runs.
 *
 * Required environment variables (never logged, never committed - put them
 * in a local, gitignored .env.local or export them in your shell):
 *
 *   SUPABASE_TEST_USER_A_EMAIL / SUPABASE_TEST_USER_A_PASSWORD
 *   SUPABASE_TEST_USER_B_EMAIL / SUPABASE_TEST_USER_B_PASSWORD
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from
 * .env.local. Never uses a service-role/secret key - both accounts sign in
 * through the normal password flow, exactly like a real user, and every
 * operation goes through their own authenticated session (RLS-governed).
 *
 * Lifecycle per run:
 *   1. Sign in to both accounts - refuses to continue (throws, exit 1) if
 *      either fails to authenticate.
 *   2. Pre-flight: if either account still has a leftover membership/
 *      organization from a previous run that didn't finish cleaning up
 *      (e.g. it crashed), delete that membership's data and the membership
 *      row itself before proceeding - bootstrap_organization refuses to run
 *      for a user with any existing active membership, so this is required
 *      for the script to be reliably rerunnable, not just tidiness.
 *   3. Bootstrap a fresh disposable organization for each account.
 *   4. Run the full live integration suite against those fresh
 *      organizations.
 *   5. Clean up: delete every application data row and the membership row
 *      for both accounts.
 *   6. The two Auth accounts themselves are NEVER deleted - they're the
 *      whole point of this change, kept for the next run.
 *
 * One structural limitation this script cannot route around without a
 * service-role key (which it will never use): `organizations` has no
 * INSERT/UPDATE/DELETE policy for `authenticated` at all - only trusted/
 * service-role tooling can write there (see
 * supabase/migrations/20260829120100_organizations.sql). So this script
 * deletes everything it has access to (all app data + the membership row),
 * leaving each run's `organizations` row orphaned (empty, harmless, but not
 * deleted). The script prints each run's orphaned org id so a follow-up
 * privileged cleanup (`supabase db query --linked "delete from organizations
 * where id in (...)"`, cascades to nothing since the membership is already
 * gone) can remove them - that step is intentionally outside this script,
 * the same way it's been done manually throughout this milestone.
 *
 * Run: npm run verify:supabase-migration
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import type { Database } from "@/lib/data/supabase.types";
import type { AppData } from "@/lib/data/types";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import { SupabaseDataRepository, fetchAppData } from "@/lib/data/supabaseDataRepository";
import { migrateLocalData, markMigrationComplete } from "@/lib/data/migration/migrateLocalData";
import { validateMigratedData } from "@/lib/data/migration/validateMigratedData";
import { buildLocalDataBackup, serializeBackup } from "@/lib/data/migration/downloadBackup";

function loadEnvLocal() {
  try {
    const contents = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}. See this script's module doc comment.`);
    process.exit(1);
  }
  return value;
}

/** Never logs the password or the resulting session/access token - only whether sign-in succeeded. */
async function signIn(email: string, password: string): Promise<{ client: SupabaseClient<Database>; userId: string }> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`Sign-in failed for ${email} - refusing to continue: ${error?.message ?? "no user returned"}`);
  }
  return { client, userId: data.user.id };
}

async function bootstrap(client: SupabaseClient<Database>, name: string): Promise<OwnerContext> {
  const { data, error } = await client.rpc("bootstrap_organization", { organization_name: name });
  if (error) throw new Error(`bootstrap_organization failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { organizationId: row.organization_id, membershipId: row.membership_id };
}

/**
 * Deletes every application data row owned by this membership, then the
 * membership row itself - in child-before-parent order, mirroring
 * applyDiff's delete pass. Used both as end-of-run cleanup and as
 * pre-flight cleanup for a leftover membership from a previous run that
 * didn't finish. Never touches `organizations` (see module doc comment)
 * or the Auth user/profile.
 */
async function deleteAllDataForMembership(client: SupabaseClient<Database>, ctx: OwnerContext): Promise<void> {
  // school_calendar_exceptions has no owner_membership_id column at all -
  // ownership is inherited through its parent school_year_calendars row
  // (the dual-ownership correction), so it must be deleted by looking up
  // that parent's id first, before the generic loop below deletes the
  // parent itself.
  const { data: ownCalendars } = await client
    .from("school_year_calendars")
    .select("id")
    .eq("owner_membership_id", ctx.membershipId);
  for (const calendar of ownCalendars ?? []) {
    await client.from("school_calendar_exceptions").delete().eq("school_year_calendar_id", calendar.id);
  }

  const tables = [
    "class_presentation_settings",
    "library_resource_courses",
    "library_resources",
    "lesson_class_sections",
    "lessons",
    "school_year_calendars",
    "schedule_block_overrides",
    "schedule_blocks",
    "bell_schedules",
    "class_sections",
    "courses",
    "classroom_experience_settings",
    "teacher_schedule_preferences",
  ] as const;
  for (const table of tables) {
    await client.from(table).delete().eq("owner_membership_id", ctx.membershipId);
  }
  await client.from("organization_memberships").delete().eq("id", ctx.membershipId);
}

/**
 * Pre-flight: if this test account already has a membership left over from
 * a previous run that crashed before cleaning up, remove it (and its data)
 * before bootstrapping a fresh one - bootstrap_organization unconditionally
 * refuses to run for a user with any existing membership, so this is
 * required for repeatability, not just hygiene. Returns the leftover
 * organization id if one was found and cleaned, for reporting.
 */
async function cleanupLeftoverMembership(client: SupabaseClient<Database>, userId: string): Promise<string | null> {
  const { data, error } = await client.from("organization_memberships").select("id, organization_id").eq("user_id", userId);
  if (error) throw new Error(`Pre-flight membership lookup failed: ${error.message}`);
  if (!data || data.length === 0) return null;

  for (const membership of data) {
    await deleteAllDataForMembership(client, { organizationId: membership.organization_id, membershipId: membership.id });
  }
  return data[0].organization_id;
}

function realisticAppData(prefix: string): AppData {
  return {
    courses: [{ id: `${prefix}-course-1`, name: "Algebra 1", colorHex: "#2563eb", description: "Intro algebra" }],
    classSections: [{ id: `${prefix}-section-1`, courseId: `${prefix}-course-1`, name: "Algebra 1 - Period 1", room: "204" }],
    schedules: [
      {
        id: `${prefix}-schedule-custom`,
        name: "My Custom Schedule",
        isDefault: true,
        timeZone: "America/Detroit",
        source: "custom",
        needsConfiguration: false,
        blocks: [
          {
            id: `${prefix}-block-1`,
            label: "Period 1",
            kind: "instructional",
            startTime: "08:00",
            endTime: "08:50",
            classSectionId: `${prefix}-section-1`,
            isLunchWindow: false,
            overrides: [{ id: `${prefix}-override-1`, weekday: "thursday", label: "SAT Prep", classSectionId: null }],
          },
        ],
      },
      {
        id: `${prefix}-schedule-builtin`,
        name: "OHHS Regular Day",
        isDefault: false,
        timeZone: "America/Detroit",
        source: "built-in",
        needsConfiguration: false,
        blocks: [
          {
            id: `${prefix}-block-builtin-1`,
            label: "Period 1",
            kind: "instructional",
            startTime: "08:00",
            endTime: "08:50",
            classSectionId: null,
            isLunchWindow: false,
            overrides: [],
          },
        ],
      },
    ],
    lessons: [
      {
        id: `${prefix}-lesson-1`,
        date: "2026-09-15",
        classSectionId: `${prefix}-section-1`,
        learningTarget: "Solve linear equations",
        agendaItems: [{ id: `${prefix}-ai-1`, title: "Warm-up", isCompleted: false, sortOrder: 0 }],
        resources: [{ id: `${prefix}-lr-1`, title: "Worksheet", url: "https://example.com/w.pdf", type: "pdf" }],
        announcements: [{ id: `${prefix}-an-1`, text: "Quiz Friday" }],
        materials: "Guided notes, calculators",
        createdAt: "2026-09-14T12:00:00.000Z",
        updatedAt: "2026-09-14T12:00:00.000Z",
      },
    ],
    classPresentationSettings: [{ classSectionId: `${prefix}-section-1`, arrivalInstructions: ["Take out notebook"] }],
    classroomExperienceSettings: {
      finalFiveMessage: "Wrap up!",
      showEndOfDayScreen: true,
      endOfDayMessage: "Have a great afternoon.",
      cleanScreenDefaultMessage: "Work Time",
      showClockOnCleanScreen: true,
      transitionCountdownEnabled: true,
      transitionArrivalInstructionsEnabled: true,
      watermarkOpacity: 0.35,
      bellOffsetSeconds: -12,
    },
    libraryResources: [
      {
        id: `${prefix}-resource-1`,
        title: "Khan Academy",
        url: "https://khanacademy.org",
        type: "link",
        courseIds: [`${prefix}-course-1`],
        tags: ["review"],
        isFavorite: true,
        source: { kind: "manual" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    teacherSchedulePreferences: { lunchWave: "B" },
    schoolCalendar: {
      id: `${prefix}-calendar-1`,
      name: "2026-27 School Year",
      schoolYear: "2026-2027",
      timeZone: "America/Detroit",
      firstStudentDay: "2026-08-25",
      lastStudentDay: "2027-06-10",
      defaultBellScheduleId: `${prefix}-schedule-custom`,
      exceptions: [{ id: `${prefix}-exc-1`, startDate: "2026-09-07", endDate: "2026-09-07", type: "no-school", title: "Labor Day" }],
    },
  };
}

async function main() {
  const emailA = requiredEnv("SUPABASE_TEST_USER_A_EMAIL");
  const passwordA = requiredEnv("SUPABASE_TEST_USER_A_PASSWORD");
  const emailB = requiredEnv("SUPABASE_TEST_USER_B_EMAIL");
  const passwordB = requiredEnv("SUPABASE_TEST_USER_B_PASSWORD");

  console.log("Setup: sign in to both persistent test accounts (refuses to continue if either fails)");
  const { client: clientA, userId: userIdA } = await signIn(emailA, passwordA);
  const { client: clientB, userId: userIdB } = await signIn(emailB, passwordB);
  console.log("  signed in as both test accounts");

  console.log("\nPre-flight: clean up any leftover membership/data from a previous incomplete run");
  const leftoverOrgA = await cleanupLeftoverMembership(clientA, userIdA);
  const leftoverOrgB = await cleanupLeftoverMembership(clientB, userIdB);
  if (leftoverOrgA) console.log(`  cleaned up a leftover membership for user A (org ${leftoverOrgA} now orphaned, needs privileged deletion)`);
  if (leftoverOrgB) console.log(`  cleaned up a leftover membership for user B (org ${leftoverOrgB} now orphaned, needs privileged deletion)`);
  if (!leftoverOrgA && !leftoverOrgB) console.log("  nothing to clean up - both accounts started with zero memberships");

  console.log("\nBootstrap a fresh disposable organization for each account");
  const ctxA = await bootstrap(clientA, "Falcon Deck Migration Test Org A");
  const ctxB = await bootstrap(clientB, "Falcon Deck Migration Test Org B");
  check("user A got a distinct organization/membership", Boolean(ctxA.organizationId && ctxA.membershipId));
  check("user B got a distinct organization/membership", Boolean(ctxB.organizationId && ctxB.membershipId));
  check("user A and user B are in different organizations", ctxA.organizationId !== ctxB.organizationId);

  try {

  console.log("\n15. Local backup is an independent snapshot, built before migration");
  const snapshotA = realisticAppData("a");
  const backup = buildLocalDataBackup(snapshotA);
  const serialized = serializeBackup(backup);
  snapshotA.courses[0].name = "MUTATED AFTER BACKUP";
  check("mutating the live AppData after backup does not change the backup", backup.appData.courses[0].name === "Algebra 1");
  check("the serialized backup string also reflects the pre-mutation snapshot", serialized.includes("Algebra 1") && !serialized.includes("MUTATED"));
  snapshotA.courses[0].name = "Algebra 1"; // restore for the rest of the test

  console.log("\n2-11. Full migration (courses, sections, custom+built-in schedules, overrides, lessons w/ materials, resources w/ links, presentation, experience w/ bellOffsetSeconds, prefs, calendar+exceptions)");
  const firstResult = await migrateLocalData(clientA, ctxA, snapshotA);
  check("first migration succeeds", firstResult.ok === true);
  if (firstResult.ok) {
    check("counts: 1 course, 1 section, 2 schedules (custom + built-in), 2 blocks, 1 override", firstResult.counts.courses === 1 && firstResult.counts.classSections === 1 && firstResult.counts.bellSchedules === 2 && firstResult.counts.scheduleBlocks === 2 && firstResult.counts.scheduleBlockOverrides === 1);
    check("counts: 1 lesson, 1 lesson_class_sections row", firstResult.counts.lessons === 1 && firstResult.counts.lessonClassSections === 1);
    check("counts: 1 library resource, 1 course link", firstResult.counts.libraryResources === 1 && firstResult.counts.libraryResourceCourseLinks === 1);
    check("counts: 1 school_year_calendar (teacher-owned, dual-ownership correction), 1 exception", firstResult.counts.schoolYearCalendars === 1 && firstResult.counts.schoolCalendarExceptions === 1);
  }

  console.log("\n17. load() after migration reconstructs the same AppData shape");
  const reloaded = await fetchAppData(clientA, ctxA);
  check("reloaded courses match", reloaded.courses.length === 1 && reloaded.courses[0].name === "Algebra 1");
  check("reloaded built-in schedule is present, teacher-owned in effect, blocks/overrides intact", reloaded.schedules.some((s) => s.id === "a-schedule-builtin" && s.blocks.length === 1));
  check("reloaded custom schedule kept its override", reloaded.schedules.find((s) => s.id === "a-schedule-custom")?.blocks[0]?.overrides.length === 1);
  check("reloaded lesson kept materials", reloaded.lessons[0]?.materials === "Guided notes, calculators");
  check("reloaded classroomExperienceSettings kept bellOffsetSeconds", reloaded.classroomExperienceSettings.bellOffsetSeconds === -12);
  check("reloaded classroomExperienceSettings watermark is undefined (not yet migrated, as documented)", reloaded.classroomExperienceSettings.customWatermarkDataUrl === undefined);
  check("reloaded schoolCalendar is present with its exception", reloaded.schoolCalendar?.exceptions.length === 1);

  console.log("\n5. Validation passes for a genuinely-correct migration");
  const validation = await validateMigratedData(clientA, ctxA, snapshotA, firstResult as Extract<typeof firstResult, { ok: true }>);
  check("validateMigratedData reports ok:true with zero mismatches", validation.ok === true && validation.mismatches.length === 0);

  console.log("\n14. Parity validation correctly detects a real mismatch (not a false pass)");
  const tamperedSnapshot: AppData = { ...snapshotA, lessons: [...snapshotA.lessons, { ...snapshotA.lessons[0], id: "a-lesson-NEVER-MIGRATED" }] };
  const tamperedValidation = await validateMigratedData(clientA, ctxA, tamperedSnapshot, firstResult as Extract<typeof firstResult, { ok: true }>);
  check("validation fails when the expected snapshot has data that was never migrated", tamperedValidation.ok === false);
  check(
    "the reported mismatch names the missing lesson",
    !tamperedValidation.ok && tamperedValidation.mismatches.some((m) => m.entity === "lessons" && m.detail.includes("a-lesson-NEVER-MIGRATED")),
  );

  console.log("\n12. Retry before marking complete is idempotent (no duplicates)");
  const secondResult = await migrateLocalData(clientA, ctxA, snapshotA);
  check("second call (before marking complete) succeeds again, not rejected", secondResult.ok === true);
  const reloadedAfterRetry = await fetchAppData(clientA, ctxA);
  check("no duplicate courses/sections/lessons/resources after retry", reloadedAfterRetry.courses.length === 1 && reloadedAfterRetry.classSections.length === 1 && reloadedAfterRetry.lessons.length === 1 && reloadedAfterRetry.libraryResources.length === 1);
  check("no duplicate schedules or blocks after retry", reloadedAfterRetry.schedules.length === 2 && reloadedAfterRetry.schedules.reduce((n, s) => n + s.blocks.length, 0) === 2);

  console.log("\nMark migration complete only now, after validation passed");
  await markMigrationComplete(clientA, ctxA.membershipId);
  const { data: membershipRow } = await clientA.from("organization_memberships").select("local_data_migrated_at").eq("id", ctxA.membershipId).single();
  check("local_data_migrated_at is now set", Boolean(membershipRow?.local_data_migrated_at));

  console.log("\nThird call is rejected once already marked complete");
  const thirdResult = await migrateLocalData(clientA, ctxA, snapshotA);
  check("migrateLocalData refuses to run again once local_data_migrated_at is set", thirdResult.ok === false && "alreadyMigrated" in thirdResult && thirdResult.alreadyMigrated === true);

  console.log("\n13. Simulated partial failure leaves local_data_migrated_at null and is retry-safe");
  const baseForBroken = realisticAppData("bad");
  const brokenSnapshot: AppData = {
    ...baseForBroken,
    schedules: [
      {
        id: "bad-schedule-invalid",
        name: "Invalid Times",
        isDefault: true,
        timeZone: "America/Detroit",
        source: "custom",
        needsConfiguration: false,
        // end_time <= start_time violates schedule_blocks_time_range CHECK - a real DB-level failure, not a client-side validation stub.
        blocks: [{ id: "bad-block-1", label: "Broken", kind: "instructional", startTime: "09:00", endTime: "08:00", classSectionId: null, isLunchWindow: false, overrides: [] }],
      },
    ],
    // Fixture correction: the base fixture's schoolCalendar points at
    // "bad-schedule-custom", which the override above replaces out of
    // `schedules` entirely - left as-is, the calendar would reference a
    // schedule that never exists in either this snapshot or its later
    // corrected retry, tripping school_year_calendars' own
    // default_bell_schedule_id FK for a reason unrelated to the
    // intentionally-broken schedule block. Point it at the schedule this
    // fixture actually provides instead.
    schoolCalendar: { ...baseForBroken.schoolCalendar!, defaultBellScheduleId: "bad-schedule-invalid" },
  };
  const failedResult = await migrateLocalData(clientB, ctxB, brokenSnapshot);
  check("migration with an invalid row reports failure, not success", failedResult.ok === false && !("alreadyMigrated" in failedResult && failedResult.alreadyMigrated));
  const { data: membershipBRow } = await clientB.from("organization_memberships").select("local_data_migrated_at").eq("id", ctxB.membershipId).single();
  check("local_data_migrated_at remains null after the failed attempt", membershipBRow?.local_data_migrated_at === null);

  console.log("Retry with corrected data succeeds, with no leftover/orphan rows from the failed attempt");
  const fixedSnapshot: AppData = { ...brokenSnapshot, schedules: [{ ...brokenSnapshot.schedules[0], blocks: [{ ...brokenSnapshot.schedules[0].blocks[0], startTime: "08:00", endTime: "09:00" }] }] };
  const retryAfterFailure = await migrateLocalData(clientB, ctxB, fixedSnapshot);
  check("retry after a partial failure succeeds", retryAfterFailure.ok === true);
  const reloadedB = await fetchAppData(clientB, ctxB);
  check("exactly one schedule exists for user B after the fix (no orphan from the failed attempt)", reloadedB.schedules.length === 1 && reloadedB.schedules[0].blocks[0].startTime === "08:00");

  console.log("\n16. RLS isolation between two different organizations/users");
  const bDataFromAsClientA = await fetchAppData(clientA, { organizationId: ctxB.organizationId, membershipId: ctxB.membershipId });
  check("user A querying user B's org/membership context sees nothing (RLS, not application filtering)", bDataFromAsClientA.classSections.length === 0 && bDataFromAsClientA.lessons.length === 0);
  const { error: crossWriteError } = await clientA.from("class_sections").insert({ id: "cross-org-attempt", organization_id: ctxB.organizationId, owner_membership_id: ctxB.membershipId, course_id: "does-not-matter", name: "Should be rejected" });
  check("user A cannot write a row into user B's organization/membership (RLS rejects it)", crossWriteError !== null);
  const finalReloadA = await fetchAppData(clientA, ctxA);
  const finalReloadB = await fetchAppData(clientB, ctxB);
  check("user A's data is unaffected by user B's activity", finalReloadA.classSections.length === 1 && finalReloadA.classSections[0].id === "a-section-1");
  check("user B's data is unaffected by user A's activity", finalReloadB.classSections.length === 1);

  console.log("\nSupabaseDataRepository end-to-end: load() then save() then load() again reflects a real change");
  const repo = new SupabaseDataRepository(clientA, ctxA);
  const loaded = await repo.load();
  const updated: AppData = { ...loaded, teacherSchedulePreferences: { lunchWave: "C" } };
  const saveResult = await repo.save(updated);
  check("repository save() succeeds", saveResult.ok === true);
  const reloadedViaRepo = await repo.load();
  check("repository load() reflects the saved change", reloadedViaRepo.teacherSchedulePreferences.lunchWave === "C");
  } finally {
    // Runs whether the checks above passed or an exception was thrown -
    // every application data row and both membership rows are deleted
    // regardless of outcome. The two Auth accounts are never touched.
    console.log("\nCleanup: deleting all test application data and both membership rows");
    await deleteAllDataForMembership(clientA, ctxA);
    await deleteAllDataForMembership(clientB, ctxB);
    console.log("  done - both test accounts kept, ready for the next run");
    console.log(`  orphaned organizations needing a follow-up privileged delete (organizations has no authenticated write policy - see module doc comment):`);
    console.log(`    ${ctxA.organizationId}`);
    console.log(`    ${ctxB.organizationId}`);
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error running live migration verification:", error);
  process.exit(1);
});
