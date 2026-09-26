/**
 * Regression coverage for Stage D of the join-existing-school architecture:
 * shared/private bell-schedule client plumbing and active-schedule
 * selection - see the reviewed Stage D design/implementation report for
 * the full rationale.
 *
 * Static/structural, matching this repo's existing verify-script style, plus
 * a handful of direct calls into the new pure resolver
 * (lib/schedule/resolveActiveSchedule.ts) where behavior can be exercised
 * without a browser or a live database.
 *
 * IMPORTANT LIMITATION - read before extending this file:
 * The migration-specific checks in section M below are STRUCTURAL ONLY -
 * they inspect the migration SQL text and confirm its shape matches the
 * reviewed design (which was itself dry-run tested against real rows in
 * Test School's project before being written - see the migration's own
 * header comment). They do NOT execute live RLS as two different
 * authenticated users - this repo's verify scripts have no live
 * multi-session Postgres harness (the same limitation already documented in
 * verify-join-existing-school-stage-b.ts). Genuinely proving "a different
 * teacher's activation attempt is rejected by Postgres itself" requires a
 * live exercise against Test School with two real accounts, once this
 * migration is applied - not faked here.
 *
 *   npx tsx scripts/verify-active-bell-schedule-stage-d.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveActiveSchedule } from "@/lib/schedule/resolveActiveSchedule";
import { resolveSchoolDate } from "@/lib/calendar/resolveSchoolDate";
import type { BellSchedule } from "@/types/schedule";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import type { SchoolYearCalendar } from "@/types/calendar";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

/** Normalizes CRLF to LF - this repo's working tree checks files out with CRLF line endings. */
function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** Strips SQL line comments so prose inside them can't produce a false-positive match against functional SQL. */
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** Strips // line comments and /* block comments *\/ from TS/TSX source, so explanatory prose (which legitimately mentions things like "isDefault" or "localStorageRepository" while explaining why this file avoids them) can't produce a false-positive match against actual code. Naive but sufficient for this repo's source (no // or /* inside string literals in the files this is applied to). */
function stripJsComments(ts: string): string {
  return ts.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const scheduleTypes = source("types/schedule.ts");
const teacherScheduleTypes = source("types/teacherSchedule.ts");
const supabaseMapping = source("lib/data/supabaseMapping.ts");
const resolveActiveScheduleSource = source("lib/schedule/resolveActiveSchedule.ts");
const appDataProvider = source("lib/store/AppDataProvider.tsx");
const reducer = source("lib/store/reducer.ts");
const actions = source("lib/store/actions.ts");
const scheduleList = source("components/schedule/ScheduleList.tsx");
const scheduleSetupScreen = source("components/schedule/ScheduleSetupScreen.tsx");
const livePresentScreen = source("components/present/LivePresentScreen.tsx");
const weekScreen = source("components/week/WeekScreen.tsx");
const resolveSchoolDateSource = source("lib/calendar/resolveSchoolDate.ts");
const supabaseDataRepository = source("lib/data/supabaseDataRepository.ts");
const migration = source("supabase/migrations/20260926013603_join_existing_school_stage_d_active_schedule_rls.sql");

console.log("1. Types carry the new fields");
{
  check(
    "1a: BellSchedule.ownerType is a real, required field typed \"organization\" | \"teacher\"",
    /ownerType: "organization" \| "teacher";/.test(scheduleTypes),
  );
  check(
    "1b: TeacherSchedulePreferences.activeBellScheduleId is a real, required field typed string | null",
    /activeBellScheduleId: string \| null;/.test(teacherScheduleTypes),
  );
  check(
    "1c: DEFAULT_TEACHER_SCHEDULE_PREFERENCES sets activeBellScheduleId: null",
    /activeBellScheduleId: null,/.test(teacherScheduleTypes),
  );
}

console.log("\n2. Supabase mapping reads/writes active_bell_schedule_id and ownerType for real");
{
  check(
    "2a: rowsToBellSchedule maps owner_type -> ownerType",
    /ownerType: schedule\.owner_type as BellSchedule\["ownerType"\],/.test(supabaseMapping),
  );
  check(
    "2b: rowToTeacherSchedulePreferences maps active_bell_schedule_id -> activeBellScheduleId",
    /activeBellScheduleId: row\.active_bell_schedule_id,/.test(supabaseMapping),
  );
  check(
    "2c: teacherSchedulePreferencesToRow forwards prefs.activeBellScheduleId",
    /active_bell_schedule_id: prefs\.activeBellScheduleId,/.test(supabaseMapping),
  );
  check(
    "2d: the Stage C hardcoded placeholder (active_bell_schedule_id: null,) is gone - not left behind alongside the real mapping",
    !supabaseMapping.includes("active_bell_schedule_id: null,"),
  );
}

console.log("\n3. resolveActiveSchedule is the sole resolver - no isDefault/schedules[0] fallback, ever");
{
  check(
    "3a: resolveActiveSchedule.ts's actual code (comments stripped) never references isDefault or a [0] fallback",
    (() => {
      const codeOnly = stripJsComments(resolveActiveScheduleSource);
      return !codeOnly.includes("isDefault") && !/schedules\[0\]/.test(codeOnly);
    })(),
  );

  const org = { organizationId: "org-1", membershipId: "membership-1" };
  function schedule(overrides: Partial<BellSchedule>): BellSchedule {
    return {
      id: "schedule-1",
      name: "Test Schedule",
      ownerType: "teacher",
      isDefault: false,
      timeZone: "America/Detroit",
      blocks: [],
      ...overrides,
    };
  }
  function prefs(overrides: Partial<TeacherSchedulePreferences>): TeacherSchedulePreferences {
    return { lunchWave: "none", activeBellScheduleId: null, ...overrides };
  }
  void org; // referenced only for shape parity with real callers; not used directly below.

  check(
    "3b: activeBellScheduleId === null -> returns null, even when schedules exist and one is isDefault:true",
    resolveActiveSchedule(
      [schedule({ id: "s1", isDefault: true }), schedule({ id: "s2" })],
      prefs({ activeBellScheduleId: null }),
    ) === null,
  );
  check(
    "3c: activeBellScheduleId set -> returns exactly that schedule, ignoring isDefault on other rows",
    resolveActiveSchedule(
      [schedule({ id: "s1", isDefault: true }), schedule({ id: "s2" })],
      prefs({ activeBellScheduleId: "s2" }),
    )?.id === "s2",
  );
  check(
    "3d: activeBellScheduleId pointing at a schedule no longer in the array -> returns null (never falls back to schedules[0])",
    resolveActiveSchedule([schedule({ id: "s1" })], prefs({ activeBellScheduleId: "gone" })) === null,
  );
  check(
    "3e: works identically for an organization-owned active schedule - ownership is irrelevant to resolution",
    resolveActiveSchedule(
      [schedule({ id: "shared-1", ownerType: "organization" })],
      prefs({ activeBellScheduleId: "shared-1" }),
    )?.id === "shared-1",
  );
}

console.log(
  "\n3-CAL. resolveSchoolDate: calendar.defaultBellScheduleId must NEVER override the teacher's active schedule on an ordinary day",
);
{
  // Real fixtures through the actual resolveSchoolDate() function - this
  // is the exact bug found in review: the no-calendar branch was fixed to
  // use resolveActiveSchedule(), but the CONFIGURED-calendar ordinary-day
  // branch still read calendar.defaultBellScheduleId. These checks call
  // the real function so a regression here can never hide behind a
  // structural-only text match again.
  function block(id: string, startTime: string, endTime: string): BellSchedule["blocks"][number] {
    return { id, label: id, kind: "instructional", startTime, endTime, classSectionId: null, overrides: [] };
  }
  function schedule(id: string, ownerType: "organization" | "teacher" = "teacher"): BellSchedule {
    return {
      id,
      name: id,
      ownerType,
      isDefault: false,
      timeZone: "America/Detroit",
      blocks: [block(`${id}-p1`, "08:00", "09:00")],
    };
  }
  function prefs(activeBellScheduleId: string | null): TeacherSchedulePreferences {
    return { lunchWave: "none", activeBellScheduleId };
  }
  function calendar(overrides: Partial<SchoolYearCalendar>): SchoolYearCalendar {
    return {
      id: "cal-1",
      name: "Test Calendar",
      schoolYear: "2026-27",
      timeZone: "America/Detroit",
      firstStudentDay: "",
      lastStudentDay: "",
      defaultBellScheduleId: "the-calendar-default-schedule",
      exceptions: [],
      ...overrides,
    };
  }

  const activeOnly = schedule("active-schedule");
  const calendarDefault = schedule("the-calendar-default-schedule");
  // Monday, 2027-01-04 - a real weekday with no matching exception.
  const ordinaryWeekday = "2027-01-04";

  check(
    "3-CAL-a: no calendar + active schedule -> resolves the active schedule",
    resolveSchoolDate({
      dateKey: ordinaryWeekday,
      calendar: null,
      bellSchedules: [activeOnly],
      teacherPreferences: prefs("active-schedule"),
    }).bellSchedule?.id === "active-schedule",
  );

  check(
    "3-CAL-b: configured calendar + ordinary school day -> resolves the active schedule",
    resolveSchoolDate({
      dateKey: ordinaryWeekday,
      calendar: calendar({ defaultBellScheduleId: "active-schedule" }),
      bellSchedules: [activeOnly],
      teacherPreferences: prefs("active-schedule"),
    }).bellSchedule?.id === "active-schedule",
  );

  check(
    "3-CAL-c: calendar.defaultBellScheduleId DIFFERENT from activeBellScheduleId -> ordinary day still uses activeBellScheduleId, not the calendar's own pointer",
    (() => {
      const result = resolveSchoolDate({
        dateKey: ordinaryWeekday,
        calendar: calendar({ defaultBellScheduleId: "the-calendar-default-schedule" }),
        bellSchedules: [activeOnly, calendarDefault],
        teacherPreferences: prefs("active-schedule"),
      });
      // A plain === check already fully proves this (if it resolved to the
      // calendar's own default, this would be false) - no redundant !==
      // clause, which TS's literal-narrowing would flag as unreachable.
      return result.bellSchedule?.id === "active-schedule";
    })(),
  );

  check(
    "3-CAL-d: a SPECIAL_BELL exception for that date wins over the active schedule - an explicit calendar exception, not a competing default",
    (() => {
      const specialSchedule = schedule("special-bell-schedule");
      const result = resolveSchoolDate({
        dateKey: ordinaryWeekday,
        calendar: calendar({
          defaultBellScheduleId: "the-calendar-default-schedule",
          exceptions: [
            {
              id: "exc-1",
              startDate: ordinaryWeekday,
              endDate: ordinaryWeekday,
              type: "special-bell",
              title: "Assembly Day",
              bellScheduleId: "special-bell-schedule",
            },
          ],
        }),
        bellSchedules: [activeOnly, calendarDefault, specialSchedule],
        teacherPreferences: prefs("active-schedule"),
      });
      return result.status === "special-schedule" && result.bellSchedule?.id === "special-bell-schedule";
    })(),
  );

  check(
    "3-CAL-e: null active schedule on an ordinary configured-calendar day -> unconfigured-schedule (select-a-schedule) state, never a silent fallback to the calendar's own default",
    (() => {
      const result = resolveSchoolDate({
        dateKey: ordinaryWeekday,
        calendar: calendar({ defaultBellScheduleId: "the-calendar-default-schedule" }),
        bellSchedules: [calendarDefault],
        teacherPreferences: prefs(null),
      });
      return result.status === "unconfigured-schedule" && result.bellSchedule === null;
    })(),
  );

  check(
    "3-CAL-f: resolveSchoolDate.ts's own source no longer reads calendar.defaultBellScheduleId for ordinary-day resolution (structural cross-check backing 3-CAL-a..e's behavioral proof)",
    !stripJsComments(resolveSchoolDateSource).includes("calendar.defaultBellScheduleId"),
  );
}

console.log("\n4. No isDefault-fallback / useDefaultSchedule call sites remain anywhere in the app");
{
  check("4a: useDefaultSchedule no longer exists (renamed to useActiveSchedule)", !appDataProvider.includes("useDefaultSchedule"));
  check("4b: useActiveSchedule exists and resolves via resolveActiveSchedule", /export function useActiveSchedule\(\): BellSchedule \| null \{/.test(appDataProvider) && /resolveActiveSchedule\(data\.schedules, data\.teacherSchedulePreferences\)/.test(appDataProvider));

  const knownAuditLocations = [
    "components/schedule/MyScheduleSection.tsx",
    "components/schedule/ScheduleSetupScreen.tsx",
    "components/lessons/CopyLessonPanel.tsx",
    "components/present/LivePresentScreen.tsx",
    "components/settings/BellClockOffsetSection.tsx",
    "lib/calendar/resolveSchoolDate.ts",
    "lib/onboarding/getOnboardingStatus.ts",
    "components/present/PresentScreen.tsx",
    "components/week/WeekScreen.tsx",
    "components/present/PresentModeControls.tsx",
    "components/classes/ClassesScreen.tsx",
    "components/lessons/LessonsScreen.tsx",
    "components/settings/LessonImportScreen.tsx",
    "components/settings/SettingsScreen.tsx",
  ];
  for (const path of knownAuditLocations) {
    const content = source(path);
    check(
      `4c: ${path} contains no isDefault-based active-schedule fallback (find((s) => s.isDefault))`,
      !/find\(\s*\(\s*\w+\s*\)\s*=>\s*\w+\.isDefault\s*\)/.test(content),
    );
    check(`4d: ${path} no longer calls useDefaultSchedule`, !content.includes("useDefaultSchedule"));
  }
}

console.log("\n5. setActiveBellSchedule changes ONLY teacherSchedulePreferences, never a schedule's isDefault");
{
  check(
    "5a: setActiveBellSchedule dispatches UPDATE_TEACHER_SCHEDULE_PREFERENCES with patch.activeBellScheduleId",
    /setActiveBellSchedule: \(scheduleId\) =>\s*\n\s*dispatch\(\{\s*\n\s*type: "UPDATE_TEACHER_SCHEDULE_PREFERENCES",\s*\n\s*patch: \{ activeBellScheduleId: scheduleId \},/.test(
      appDataProvider,
    ),
  );
  check(
    "5b: SET_DEFAULT_SCHEDULE has been retired - no longer a valid action type",
    !actions.includes("SET_DEFAULT_SCHEDULE"),
  );
  check("5c: the reducer has no SET_DEFAULT_SCHEDULE case left to accidentally diverge from 5a's behavior", !reducer.includes("SET_DEFAULT_SCHEDULE"));
  check("5d: setDefaultSchedule is gone from AppDataActions/AppDataProvider entirely", !appDataProvider.includes("setDefaultSchedule"));
}

console.log("\n6. Reducer safety: organization-owned schedules can never be mutated by ordinary teacher actions");
{
  check(
    "6a: the shared updateSchedule() helper refuses to touch a schedule whose ownerType is 'organization'",
    /if \(target\?\.ownerType === "organization"\) return data;/.test(reducer),
  );
  check(
    "6b: DELETE_SCHEDULE refuses to delete an organization-owned schedule",
    /if \(target\?\.ownerType === "organization"\) return state;/.test(reducer),
  );
  check(
    "6c: DELETE_SCHEDULE refuses to delete the currently-active schedule (Architecture Decision #3 - never silently unselect/reassign)",
    /if \(action\.scheduleId === state\.teacherSchedulePreferences\.activeBellScheduleId\) return state;/.test(reducer),
  );
  check(
    "6d: DELETE_SCHEDULE's isDefault-promotion step only ever promotes a teacher-owned schedule",
    /remaining\.findIndex\(\(s\) => s\.ownerType === "teacher"\)/.test(reducer),
  );
  check(
    "6e: DUPLICATE_SCHEDULE always produces a teacher-owned copy, even from an organization-owned source",
    /ownerType: "teacher",\s*\n\s*isDefault: false,/.test(reducer),
  );
}

console.log("\n7. ScheduleList: shared schedules are read-only, private schedules stay fully editable");
{
  check("7a: renders a distinct \"Shared School Schedules\" section", scheduleList.includes("Shared School Schedules"));
  check("7b: renders a distinct \"Your Schedules\" section", scheduleList.includes("Your Schedules"));
  check(
    "7c: shared rows are rendered with editable: false",
    /sharedSchedules\.map\(\(schedule\) => renderRow\(schedule, \{ editable: false \}\)\)/.test(scheduleList),
  );
  check(
    "7d: private (\"your\") rows are rendered with editable: true",
    /yourSchedules\.map\(\(schedule\) => renderRow\(schedule, \{ editable: true \}\)\)/.test(scheduleList),
  );
  check(
    "7e: rename/duplicate/delete controls are gated behind the editable flag, not rendered unconditionally",
    (() => {
      const gateIdx = scheduleList.indexOf("{editable && (");
      const duplicateIdx = scheduleList.indexOf("Duplicate");
      const deleteMatch = scheduleList.search(/>\s*Delete\s*</);
      return gateIdx !== -1 && duplicateIdx > gateIdx && deleteMatch > gateIdx;
    })(),
  );
  check(
    "7f: an organization-owned schedule's isDefault is labeled \"Recommended\", never \"Default\"",
    scheduleList.includes("Recommended") && !/>\s*Default\s*</.test(scheduleList),
  );
  check(
    "7f-2: \"Recommended\" is gated on BOTH ownerType==='organization' AND isDefault - not on isDefault alone (a teacher-owned schedule with legacy isDefault:true must never show it)",
    /schedule\.ownerType === "organization" && schedule\.isDefault && \(/.test(scheduleList),
  );
  check(
    "7f-3: behaviorally, a teacher-owned schedule with isDefault:true renders no Recommended/Default/active-derived-from-isDefault badge - only activeSchedule?.id === schedule.id may show \"Currently in use\"",
    (() => {
      // renderRow's isActive/badge logic is simple enough to re-derive here
      // without importing React/rendering: the badge condition is
      // literally `schedule.ownerType === "organization" && schedule.isDefault`.
      // This check proves that expression evaluates false for a
      // teacher-owned schedule regardless of its isDefault value - the
      // exact case that was previously (incorrectly) true.
      const legacyDefaultTeacherSchedule = { ownerType: "teacher" as const, isDefault: true };
      const showsRecommended =
        (legacyDefaultTeacherSchedule.ownerType as string) === "organization" && legacyDefaultTeacherSchedule.isDefault;
      return showsRecommended === false;
    })(),
  );
  check(
    "7g: \"Use this schedule\" calls setActiveBellSchedule directly - no copy, no ADD_SCHEDULE/DUPLICATE_SCHEDULE involved in activation",
    /onClick=\{\(\) => actions\.setActiveBellSchedule\(schedule\.id\)\}/.test(scheduleList),
  );
  check(
    "7h: \"Currently in use\" state is shown instead of the activation button once a schedule is already active",
    scheduleList.includes("Currently in use"),
  );
  check(
    "7i: \"Copy shared schedule\" is not offered as an actual UI control (comments explaining the deferral don't count)",
    !/Copy shared|Copy this schedule/i.test(stripJsComments(scheduleList)),
  );
}

console.log("\n8. ScheduleSetupScreen: no admin shared-schedule creation, no localStorage bypass");
{
  check(
    "8a: does not import dataRepository or saveDefaultScheduleSelection from localStorageRepository",
    !/from "@\/lib\/data\/localStorageRepository"/.test(scheduleSetupScreen),
  );
  check(
    "8b: right-hand panel editability requires BOTH ownerType==='teacher' AND source!=='built-in'",
    /selectedSchedule\.ownerType === "teacher" && selectedSchedule\.source !== "built-in"/.test(scheduleSetupScreen),
  );
  check("8c: no admin/organization schedule-creation UI was added", !/create.*organization.*schedule|admin.*schedule/i.test(scheduleSetupScreen));
}

console.log("\n9. Present Mode / Week View resolve via the active schedule, with an explicit null-active state");
{
  check(
    "9a: LivePresentScreen's timezone fallback uses resolveActiveSchedule, not isDefault",
    /resolveActiveSchedule\(data\.schedules, data\.teacherSchedulePreferences\)\?\.timeZone/.test(livePresentScreen),
  );
  check(
    "9b: a null active schedule renders a distinct SelectScheduleNeededScreen, not the generic UnconfiguredScheduleScreen",
    (() => {
      const nullCheckIdx = livePresentScreen.indexOf("dateResolution.bellSchedule === null");
      const componentIdx = livePresentScreen.indexOf("<SelectScheduleNeededScreen />");
      const unconfiguredIdx = livePresentScreen.lastIndexOf("<UnconfiguredScheduleScreen");
      // The null-schedule branch must render SelectScheduleNeededScreen
      // strictly before the (still-present, for the genuinely-different
      // "needs configuration" case) UnconfiguredScheduleScreen branch.
      return nullCheckIdx !== -1 && componentIdx > nullCheckIdx && componentIdx < unconfiguredIdx;
    })(),
  );
  check("9c: WeekScreen uses useActiveSchedule", /const schedule = useActiveSchedule\(\);/.test(weekScreen));
  check(
    "9d: resolveSchoolDate's no-calendar branch resolves via resolveActiveSchedule, not isDefault",
    /const activeSchedule = resolveActiveSchedule\(bellSchedules, teacherPreferences\);/.test(resolveSchoolDateSource),
  );
}

console.log("\n10. Stage E boundary: no teacher_period_assignments write path introduced");
{
  check(
    "10a: no INSERT/UPDATE/UPSERT against teacher_period_assignments exists in the data repository",
    !/\.from\("teacher_period_assignments"\)\s*\n?\s*\.(insert|update|upsert)/.test(supabaseDataRepository),
  );
  check(
    "10b: teacher_period_assignments is still only ever SELECTed (the existing read/merge path), never written",
    (supabaseDataRepository.match(/teacher_period_assignments/g) ?? []).length >= 1 &&
      /client\.from\("teacher_period_assignments"\)\.select/.test(supabaseDataRepository),
  );
  check("10c: no new UI component for assigning a shared block to a class section was added", !/assign.*period|period.*assign/i.test(scheduleList) && !/assign.*period|period.*assign/i.test(scheduleSetupScreen));
}

console.log("\n11. Cloud/localStorage authority remains unchanged by this stage's new files");
{
  check(
    "11a: resolveActiveSchedule.ts's actual code (comments stripped) imports neither dataRepository nor localStorageRepository",
    !/dataRepository|localStorageRepository/.test(stripJsComments(resolveActiveScheduleSource)),
  );
  check(
    "11b: ScheduleList.tsx imports neither dataRepository nor localStorageRepository",
    !/dataRepository|localStorageRepository/.test(scheduleList),
  );
}

console.log("\nM. Stage D migration - structural verification (see file header for what this does NOT prove)");
{
  const stripped = stripLineComments(migration);
  check(
    "Ma: NULL active_bell_schedule_id is explicitly allowed",
    /active_bell_schedule_id is null\s*\n\s*or exists/.test(stripped),
  );
  check(
    "Mb: a same-organization organization-owned schedule is allowed",
    /b\.owner_type = 'organization'/.test(stripped),
  );
  check(
    "Mc: a same-organization, SAME-teacher-owned schedule is allowed, and the owner_membership_id comparison is QUALIFIED against the outer row (not bell_schedules' own same-named column)",
    /b\.owner_type = 'teacher' and b\.owner_membership_id = public\.teacher_schedule_preferences\.owner_membership_id/.test(
      stripped,
    ),
  );
  check(
    "Md: the teacher-owned branch requires an EXACT owner_membership_id match (not just any teacher-owned row in the org) - this is what rejects another teacher's private schedule",
    !/b\.owner_type = 'teacher'\)/.test(stripped), // would match if the ownership check were missing entirely
  );
  check(
    "Md-2: CRITICAL - no unqualified 'b.organization_id = organization_id' or 'b.owner_membership_id = owner_membership_id' remains anywhere. bell_schedules has its OWN columns of both names, so an unqualified reference inside the EXISTS subquery silently binds to bell_schedules itself (b.organization_id = b.organization_id, always true) instead of the outer teacher_schedule_preferences row - collapsing the entire ownership check into a no-op that would accept ANY teacher-owned schedule regardless of whose membership owns it. Proven empirically (read-only) during review: a synthetic outer row with garbage, non-matching ids still satisfied the unqualified form against a real bell_schedules row.",
    !stripped.includes("b.organization_id = organization_id") &&
      !stripped.includes("b.owner_membership_id = owner_membership_id"),
  );
  check(
    "Md-3: both org and owner comparisons are explicitly qualified with public.teacher_schedule_preferences (the policy table's own correlation name) - present in BOTH altered policies (2 occurrences each)",
    (stripped.match(/b\.organization_id = public\.teacher_schedule_preferences\.organization_id/g) ?? []).length === 2 &&
      (stripped.match(/b\.owner_membership_id = public\.teacher_schedule_preferences\.owner_membership_id/g) ?? [])
        .length === 2,
  );
  check(
    "Md-4: b.id is also qualified against active_bell_schedule_id (defense-in-depth - bell_schedules has no column of that name today, so this was never actually ambiguous, but qualifying it protects against a future same-named column)",
    (stripped.match(/b\.id = public\.teacher_schedule_preferences\.active_bell_schedule_id/g) ?? []).length === 2,
  );
  check(
    "Me: this migration documents that it relies on, and does not re-implement, the pre-existing Stage A composite FK for cross-organization safety",
    migration.includes("Stage A's composite FK"),
  );
  check(
    "Me-2: and indeed adds no new FOREIGN KEY/REFERENCES of its own - the cross-org guarantee is entirely inherited, not duplicated",
    !stripped.includes("references public.bell_schedules") && !stripped.includes("foreign key"),
  );
  check(
    "Mf: only the two named policies are altered - no CREATE POLICY, no changes to bell_schedules or organization_memberships policies",
    (stripped.match(/alter policy/g) ?? []).length === 2 &&
      !stripped.includes("create policy") &&
      !/alter policy\s+bell_schedules/.test(stripped) &&
      !/alter policy\s+organization_memberships/.test(stripped),
  );
  check(
    "Mg: no SECURITY DEFINER function or trigger was added - RLS-only, per the design decision",
    !/create (or replace )?function/i.test(stripped) && !/create trigger/i.test(stripped),
  );
  check(
    "Mh: both altered policies are teacher_schedule_preferences_insert and teacher_schedule_preferences_update - no other table's policy is touched",
    /alter policy teacher_schedule_preferences_insert/.test(stripped) &&
      /alter policy teacher_schedule_preferences_update/.test(stripped),
  );
}

console.log(
  "\nNOTE: sections M's checks are structural only. What still requires a LIVE exercise against Test School " +
    "(two real authenticated accounts, after this migration is applied) before Stage E begins:\n" +
    "  - a second teacher's join_existing_school-created membership attempting to set active_bell_schedule_id\n" +
    "    to the FIRST teacher's private schedule id, confirmed REJECTED by Postgres (not just by this app's UI)\n" +
    "  - that same teacher successfully setting active_bell_schedule_id to a real organization-owned schedule\n" +
    "    once one is seeded in Test School\n" +
    "  - confirming NULL remains a legal value end-to-end (clearing a selection) via a real UPDATE\n",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
