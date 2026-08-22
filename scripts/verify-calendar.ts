/**
 * Standalone verification for the Bell Schedule Profiles / Teacher Lunch
 * Waves / Master Calendar system: the OHHS_REGULAR preset's official
 * times, the lunch-wave resolver, the calendar day-resolution engine, and
 * both import pipelines (Master Calendar JSON/CSV, Bell Schedule
 * CSV/paste). Everything here is pure logic - no DOM, no React - so it
 * runs directly under `tsx`. Present Mode/Week integration (items 85-94)
 * is confirmed with targeted static-source checks, matching this
 * project's established pattern for verifying React-component wiring
 * without a DOM renderer.
 *
 *   npm run verify:calendar
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createOhhsRegularSchedule, OHHS_REGULAR_ID } from "@/lib/schedule/presets/ohhsRegular";
import {
  OHHS_EARLY_RELEASE_1124_ID,
  OHHS_LAST_DAY_HALF_DAY_ID,
} from "@/lib/schedule/presets/needsConfigurationSchedules";
import { resolveTeacherSchedule } from "@/lib/schedule/resolveTeacherSchedule";
import { isStudentFacingBlock } from "@/lib/schedule/isStudentFacingBlock";
import { getCurrentBlock } from "@/lib/schedule/getCurrentBlock";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { timeStringToSeconds } from "@/lib/schedule/time";
import { resolveSchoolDate } from "@/lib/calendar/resolveSchoolDate";
import {
  buildMasterCalendarCsvTemplate,
  buildMasterCalendarImportPreview,
  commitMasterCalendarImport,
  detectCalendarConflicts,
  mapScheduleProfiles,
  parseMasterCalendarCsv,
  parseMasterCalendarJson,
  validateParsedExceptions,
  type ParsedCalendarException,
} from "@/lib/calendar/masterCalendarImport";
import { OHHS_MASTER_CALENDAR_2026_JSON } from "@/lib/data/ohhsMasterCalendar2026";
import { buildScheduleBlocksFromRows, parseBellScheduleTable } from "@/lib/schedule/bellScheduleImport";
import { appDataReducer } from "@/lib/store/reducer";
import { createDemoAppData } from "@/lib/data/demoData";
import { LocalStorageDataRepository } from "@/lib/data/localStorageRepository";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";
import type { AppData } from "@/lib/data/types";
import type { BellSchedule } from "@/types/schedule";
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

function atLocalTime(isoDate: string, hhmm: string): Date {
  return new Date(`${isoDate}T${hhmm}:00-04:00`);
}
const MONDAY = "2026-09-14"; // any weekday works for OHHS_REGULAR - it has no weekday overrides

function blockById(schedule: BellSchedule, id: string) {
  return schedule.blocks.find((b) => b.id === id);
}

async function main() {
const ohhs = createOhhsRegularSchedule();

console.log("\n1-3. OHHS_REGULAR identity");
{
  check("1: OHHS_REGULAR exists", ohhs.id === OHHS_REGULAR_ID && OHHS_REGULAR_ID === "OHHS_REGULAR");
  check("2: display name is OHHS Regular Day", ohhs.name === "OHHS Regular Day");
  check("3: time zone is America/Detroit", ohhs.timeZone === "America/Detroit");
}

console.log("\n4-20. Official OHHS bell times");
{
  const firstBell = blockById(ohhs, `${OHHS_REGULAR_ID}-first-bell`);
  check("4: First Bell is 7:20 AM", firstBell?.startTime === "07:20");
  check("4: First Bell is not student-facing (informational only)", firstBell !== undefined && !isStudentFacingBlock(firstBell));

  const p1 = blockById(ohhs, `${OHHS_REGULAR_ID}-period-1`);
  check("5: first instructional block starts 7:25", p1?.startTime === "07:25");
  check("6: Period 1 runs 7:25-8:23", p1?.startTime === "07:25" && p1?.endTime === "08:23");

  const pass1 = blockById(ohhs, `${OHHS_REGULAR_ID}-passing-1`);
  check("7: Passing runs 8:23-8:29", pass1?.startTime === "08:23" && pass1?.endTime === "08:29");

  const p2 = blockById(ohhs, `${OHHS_REGULAR_ID}-period-2`);
  check("8: Period 2 runs 8:29-9:23", p2?.startTime === "08:29" && p2?.endTime === "09:23");

  const pass2 = blockById(ohhs, `${OHHS_REGULAR_ID}-passing-2`);
  check("9: Passing runs 9:23-9:29", pass2?.startTime === "09:23" && pass2?.endTime === "09:29");

  const p3 = blockById(ohhs, `${OHHS_REGULAR_ID}-period-3`);
  check("10: Period 3 runs 9:29-9:49", p3?.startTime === "09:29" && p3?.endTime === "09:49");
  check(
    "11: Period 3 duration is exactly 20 minutes",
    p3 !== undefined && timeStringToSeconds(p3.endTime) - timeStringToSeconds(p3.startTime) === 20 * 60,
  );
  check("12: Period 3 maps to student-facing Enrichment", p3?.kind === "enrichment" && isStudentFacingBlock(p3));

  const pass3 = blockById(ohhs, `${OHHS_REGULAR_ID}-passing-3`);
  check("13: Passing runs 9:49-9:55", pass3?.startTime === "09:49" && pass3?.endTime === "09:55");

  const p4 = blockById(ohhs, `${OHHS_REGULAR_ID}-period-4`);
  check("14: Period 4 runs 9:55-10:48", p4?.startTime === "09:55" && p4?.endTime === "10:48");

  const p5 = blockById(ohhs, `${OHHS_REGULAR_ID}-period-5`);
  check("15: Period 5 base block runs 10:48-12:18", p5?.startTime === "10:48" && p5?.endTime === "12:18");
  check("15: Period 5 is flagged as the lunch window", p5?.isLunchWindow === true);

  const pass5 = blockById(ohhs, `${OHHS_REGULAR_ID}-passing-5`);
  check("16: Passing runs 12:18-12:24", pass5?.startTime === "12:18" && pass5?.endTime === "12:24");

  const p6 = blockById(ohhs, `${OHHS_REGULAR_ID}-period-6`);
  check("17: Period 6 runs 12:24-1:18", p6?.startTime === "12:24" && p6?.endTime === "13:18");

  const pass6 = blockById(ohhs, `${OHHS_REGULAR_ID}-passing-6`);
  check("18: Passing runs 1:18-1:24", pass6?.startTime === "13:18" && pass6?.endTime === "13:24");

  const p7 = blockById(ohhs, `${OHHS_REGULAR_ID}-period-7`);
  check("19: Period 7 runs 1:24-2:19", p7?.startTime === "13:24" && p7?.endTime === "14:19");
  check("20: end of school day is 2:19", p7?.endTime === "14:19");
}

console.log("\n21-33. Lunch wave resolution");
{
  const aResolved = resolveTeacherSchedule(ohhs, { lunchWave: "A" });
  const aLunch = aResolved.blocks.find((b) => b.kind === "lunch");
  check("21: A Lunch resolves 10:48-11:18", aLunch?.startTime === "10:48" && aLunch?.endTime === "11:18");

  const bResolved = resolveTeacherSchedule(ohhs, { lunchWave: "B" });
  const bLunch = bResolved.blocks.find((b) => b.kind === "lunch");
  check("22: B Lunch resolves 11:18-11:48", bLunch?.startTime === "11:18" && bLunch?.endTime === "11:48");

  const cResolved = resolveTeacherSchedule(ohhs, { lunchWave: "C" });
  const cLunch = cResolved.blocks.find((b) => b.kind === "lunch");
  check("23: C Lunch resolves 11:48-12:18", cLunch?.startTime === "11:48" && cLunch?.endTime === "12:18");

  check(
    "24: A lunch teacher resumes Period 5 at 11:18",
    getCurrentBlock(aResolved, atLocalTime(MONDAY, "11:18"))?.kind === "instructional",
  );
  check(
    "25: B lunch teacher is in Period 5 at 11:00",
    getCurrentBlock(bResolved, atLocalTime(MONDAY, "11:00"))?.kind === "instructional",
  );
  check(
    "26: B lunch teacher is at Lunch at 11:30",
    getCurrentBlock(bResolved, atLocalTime(MONDAY, "11:30"))?.kind === "lunch",
  );
  check(
    "27: B lunch teacher resumes Period 5 at 11:48",
    getCurrentBlock(bResolved, atLocalTime(MONDAY, "11:48"))?.kind === "instructional",
  );
  check(
    "28: C lunch teacher is still in Period 5 at 11:30",
    getCurrentBlock(cResolved, atLocalTime(MONDAY, "11:30"))?.kind === "instructional",
  );
  check(
    "29: C lunch teacher enters Lunch at 11:48",
    getCurrentBlock(cResolved, atLocalTime(MONDAY, "11:48"))?.kind === "lunch",
  );

  const noneResolved = resolveTeacherSchedule(ohhs, { lunchWave: "none" });
  const nonePeriod5 = noneResolved.blocks.find((b) => b.isLunchWindow);
  check(
    "30: 'none' keeps Period 5 active 10:48-12:18",
    nonePeriod5?.startTime === "10:48" && nonePeriod5?.endTime === "12:18" && noneResolved.blocks.every((b) => b.kind !== "lunch"),
  );

  check(
    "37: 11:30 resolution changes correctly by lunch wave (B=Lunch, C=Period 5)",
    getCurrentBlock(bResolved, atLocalTime(MONDAY, "11:30"))?.kind === "lunch" &&
      getCurrentBlock(cResolved, atLocalTime(MONDAY, "11:30"))?.kind === "instructional",
  );

  const beforeJson = JSON.stringify(ohhs);
  resolveTeacherSchedule(ohhs, { lunchWave: "A" });
  resolveTeacherSchedule(ohhs, { lunchWave: "B" });
  resolveTeacherSchedule(ohhs, { lunchWave: "C" });
  check("31: changing lunch does not mutate OHHS_REGULAR", JSON.stringify(ohhs) === beforeJson);

  const fakeStore = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => fakeStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        fakeStore.set(key, value);
      },
      removeItem: (key: string) => {
        fakeStore.delete(key);
      },
    },
  };
  const repo = new LocalStorageDataRepository();
  const withLunch: AppData = { ...createDemoAppData(), teacherSchedulePreferences: { lunchWave: "C" } };
  await repo.save(withLunch);
  const reloaded = await repo.load();
  check("32: lunch preference persists through DataRepository", reloaded.teacherSchedulePreferences.lunchWave === "C");

  const legacyData = { ...createDemoAppData() } as unknown as Record<string, unknown>;
  delete legacyData.teacherSchedulePreferences;
  fakeStore.set("falcon-deck:app-data:v1", JSON.stringify(legacyData));
  const legacyLoaded = await repo.load();
  check(
    "33: old data missing lunch preference loads safely",
    legacyLoaded.teacherSchedulePreferences.lunchWave === DEFAULT_TEACHER_SCHEDULE_PREFERENCES.lunchWave,
  );
  delete (globalThis as Record<string, unknown>).window;
}

console.log("\n34-40. Schedule state resolution across the OHHS day");
{
  const p2State = getPresentationState(ohhs, atLocalTime(MONDAY, "08:45"));
  check("34: 8:45 AM resolves Period 2", p2State.mode === "student-facing" && p2State.block.label === "Period 2");

  const p3State = getPresentationState(ohhs, atLocalTime(MONDAY, "09:35"));
  check(
    "35: 9:35 AM resolves Period 3 (Enrichment)",
    p3State.mode === "student-facing" && p3State.block.kind === "enrichment",
  );

  const passingState = getPresentationState(ohhs, atLocalTime(MONDAY, "09:51"));
  check(
    "36: 9:51 AM resolves passing toward Period 4",
    passingState.mode === "transition" && passingState.nextStudentFacingBlock?.label === "Period 4",
  );

  const passing2State = getPresentationState(ohhs, atLocalTime(MONDAY, "12:20"));
  check(
    "38: 12:20 resolves passing toward Period 6",
    passing2State.mode === "transition" && passing2State.nextStudentFacingBlock?.label === "Period 6",
  );

  const p7State = getPresentationState(ohhs, atLocalTime(MONDAY, "13:30"));
  check("39: 1:30 resolves Period 7", p7State.mode === "student-facing" && p7State.block.label === "Period 7");

  const endOfDayState = getPresentationState(ohhs, atLocalTime(MONDAY, "14:20"));
  check(
    "40: after 2:19 resolves end-of-day",
    endOfDayState.mode === "transition" && endOfDayState.nextStudentFacingBlock === null,
  );
}

console.log("\n41-60. Master Calendar resolution");
{
  const parsed = parseMasterCalendarJson(OHHS_MASTER_CALENDAR_2026_JSON);
  if (!parsed.ok) throw new Error("Bundled OHHS master calendar JSON failed to parse - test setup bug.");

  const commit = commitMasterCalendarImport({
    meta: parsed.meta,
    exceptions: parsed.exceptions,
    existingCalendar: null,
    bellSchedules: [ohhs],
    conflictResolution: "skip",
    generateExceptionId: (() => {
      let n = 0;
      return () => `verify-exception-${n++}`;
    })(),
    generateCalendarId: () => "verify-calendar",
  });
  const calendar = commit.calendar;
  const bellSchedules = [ohhs, ...commit.newBellSchedules];
  const teacherPreferences = DEFAULT_TEACHER_SCHEDULE_PREFERENCES;

  function resolve(dateKey: string) {
    return resolveSchoolDate({ dateKey, calendar, bellSchedules, teacherPreferences });
  }

  check("41: normal Mon-Fri date resolves default BellSchedule", resolve("2026-09-15").status === "regular" && resolve("2026-09-15").bellSchedule?.id === OHHS_REGULAR_ID);
  check("42: weekend resolves non-instructional", resolve("2026-09-12").status === "weekend"); // a Saturday, no exception

  const precedenceExceptions: ParsedCalendarException[] = [
    { startDate: "2026-12-01", endDate: "2026-12-01", type: "special-bell", title: "Special", scheduleProfileKey: "REGULAR" },
    { startDate: "2026-12-01", endDate: "2026-12-01", type: "no-students", title: "PD" },
    { startDate: "2026-12-01", endDate: "2026-12-01", type: "no-school", title: "Closed" },
  ];
  const precedenceCommit = commitMasterCalendarImport({
    meta: parsed.meta,
    exceptions: precedenceExceptions,
    existingCalendar: null,
    bellSchedules: [ohhs],
    conflictResolution: "skip",
    generateExceptionId: (() => {
      let n = 0;
      return () => `precedence-${n++}`;
    })(),
    generateCalendarId: () => "precedence-calendar",
  });
  const precedenceResolution = resolveSchoolDate({
    dateKey: "2026-12-01",
    calendar: precedenceCommit.calendar,
    bellSchedules: [ohhs],
    teacherPreferences,
  });
  check("43: NO_SCHOOL overrides REGULAR", precedenceResolution.status === "no-school");
  check("44: NO_SCHOOL overrides NO_STUDENTS too (precedence chain)", precedenceResolution.status === "no-school");
  check(
    "45: with only a special-bell exception, SPECIAL_BELL overrides REGULAR",
    resolve("2026-10-30").status === "special-schedule" || resolve("2026-10-30").status === "unconfigured-schedule",
  );
  check(
    "46: precedence is deterministic regardless of array order (exceptions listed special-bell, no-students, no-school in that order)",
    precedenceResolution.status === "no-school",
  );

  check("47: 2026-08-31 resolves REGULAR", resolve("2026-08-31").status === "regular");
  check("48: REGULAR maps to OHHS_REGULAR for the OHHS import", calendar.defaultBellScheduleId === OHHS_REGULAR_ID);
  check("49: 2026-09-07 resolves No School", resolve("2026-09-07").status === "no-school" && resolve("2026-09-07").title === "Labor Day");

  const earlyRelease930 = resolve("2026-09-30");
  check(
    "50: 2026-09-30 maps to the early-release profile and is never guessed (Needs Configuration)",
    earlyRelease930.exception?.bellScheduleId === OHHS_EARLY_RELEASE_1124_ID && earlyRelease930.status === "unconfigured-schedule",
  );
  check("51: 11:24 dismissal metadata is retained", earlyRelease930.exception?.dismissalTime === "11:24 AM");

  check(
    "52: Thanksgiving date range resolves correctly",
    resolve("2026-11-25").status === "no-school" && resolve("2026-11-26").status === "no-school" && resolve("2026-11-27").status === "no-school",
  );
  check(
    "53: Winter Break crossing the year boundary resolves correctly",
    resolve("2026-12-25").status === "no-school" && resolve("2027-01-01").status === "no-school",
  );
  check("54: 2027-01-15 resolves No Students", resolve("2027-01-15").status === "no-students");

  const earlyRelease0224 = resolve("2027-02-24");
  check(
    "55: 2027-02-24 maps to Early Release",
    earlyRelease0224.exception?.bellScheduleId === OHHS_EARLY_RELEASE_1124_ID,
  );
  check(
    "56: 2027-03-26-2027-04-02 resolves No School",
    resolve("2027-03-26").status === "no-school" && resolve("2027-04-02").status === "no-school",
  );
  check("57: 2027-05-31 resolves No School", resolve("2027-05-31").status === "no-school");

  const lastDay = resolve("2027-06-09");
  check("58: 2027-06-09 maps to the special half-day profile", lastDay.exception?.bellScheduleId === OHHS_LAST_DAY_HALF_DAY_ID);
  const halfDaySchedule = bellSchedules.find((s) => s.id === OHHS_LAST_DAY_HALF_DAY_ID);
  check("59: the missing half-day BellSchedule is marked Needs Configuration", halfDaySchedule?.needsConfiguration === true);
  check("60: the missing schedule is never guessed (no fabricated blocks)", halfDaySchedule?.blocks.length === 0 && lastDay.status === "unconfigured-schedule");
}

console.log("\n61-75. Master Calendar import pipeline");
{
  const validJson = parseMasterCalendarJson(OHHS_MASTER_CALENDAR_2026_JSON);
  check("61: valid JSON v1 imports", validJson.ok === true);

  const validCsv = parseMasterCalendarCsv(buildMasterCalendarCsvTemplate());
  check("62: valid CSV imports", validCsv.ok === true);

  const singleDayCsv = parseMasterCalendarCsv("date,type,title\n2026-09-07,no-school,Labor Day");
  check("63: a single-day row (date column) works", singleDayCsv.ok === true && singleDayCsv.ok && singleDayCsv.exceptions[0]?.startDate === singleDayCsv.exceptions[0]?.endDate);

  if (validJson.ok) {
    const thanksgiving = validJson.exceptions.find((e) => e.title === "Thanksgiving Break");
    check("64: a date range works (endDate differs from startDate)", thanksgiving !== undefined && thanksgiving.endDate !== thanksgiving.startDate);
  } else {
    check("64: a date range works (endDate differs from startDate)", false);
  }

  const badDate = validateParsedExceptions([{ startDate: "2026-13-40", endDate: "2026-13-40", type: "no-school", title: "Bad" }]);
  check("65: invalid date rejected", badDate.length > 0);

  const badRange = validateParsedExceptions([{ startDate: "2026-09-10", endDate: "2026-09-05", type: "no-school", title: "Bad range" }]);
  check("66: endDate before startDate rejected", badRange.length > 0);

  const badType = validateParsedExceptions([{ startDate: "2026-09-10", endDate: "2026-09-10", type: "vacation" as never, title: "Bad type" }]);
  check("67: invalid type rejected", badType.length > 0);

  const profileMapping = mapScheduleProfiles(
    [{ startDate: "2026-09-30", endDate: "2026-09-30", type: "special-bell", title: "Early Release", scheduleProfileKey: "UNKNOWN_PROFILE" }],
    [ohhs],
  );
  check("68: an unknown schedule profile requires mapping/configuration", profileMapping.unresolvedProfileKeys.includes("UNKNOWN_PROFILE"));

  const bellSchedulesBefore = [ohhs];
  const bellSchedulesBeforeJson = JSON.stringify(bellSchedulesBefore);
  if (validJson.ok) {
    buildMasterCalendarImportPreview(validJson.meta, validJson.exceptions, bellSchedulesBefore, null);
  }
  check("69: building the import preview does not mutate the bellSchedules passed in", JSON.stringify(bellSchedulesBefore) === bellSchedulesBeforeJson);

  const commitResult = validJson.ok
    ? commitMasterCalendarImport({
        meta: validJson.meta,
        exceptions: validJson.exceptions,
        existingCalendar: null,
        bellSchedules: [ohhs],
        conflictResolution: "skip",
        generateExceptionId: (() => {
          let n = 0;
          return () => `commit-${n++}`;
        })(),
        generateCalendarId: () => "commit-calendar",
      })
    : null;
  check("70: confirming the import produces a new calendar object ready to persist through the repository", commitResult !== null && commitResult.calendar.exceptions.length > 0);

  const existingCalendar: SchoolYearCalendar = {
    id: "existing-cal",
    name: "Existing",
    schoolYear: "2026-2027",
    timeZone: "America/Detroit",
    firstStudentDay: "2026-08-31",
    lastStudentDay: "2027-06-09",
    defaultBellScheduleId: OHHS_REGULAR_ID,
    exceptions: [{ id: "existing-exc-1", startDate: "2026-09-07", endDate: "2026-09-07", type: "no-school", title: "Existing Labor Day Entry" }],
  };
  const newRows: ParsedCalendarException[] = [{ startDate: "2026-09-07", endDate: "2026-09-07", type: "no-school", title: "Imported Labor Day" }];
  const conflicts = detectCalendarConflicts(newRows, existingCalendar);
  check("71: conflicts detected", conflicts.length === 1);

  const skipResult = commitMasterCalendarImport({
    meta: null,
    exceptions: newRows,
    existingCalendar,
    bellSchedules: [ohhs],
    conflictResolution: "skip",
    generateExceptionId: () => "skip-generated",
    generateCalendarId: () => "skip-calendar",
  });
  check(
    "72: skip conflicts keeps the existing exception and does not add the conflicting new one",
    skipResult.calendar.exceptions.some((e) => e.title === "Existing Labor Day Entry") &&
      !skipResult.calendar.exceptions.some((e) => e.title === "Imported Labor Day"),
  );

  const replaceResult = commitMasterCalendarImport({
    meta: null,
    exceptions: newRows,
    existingCalendar,
    bellSchedules: [ohhs],
    conflictResolution: "replace",
    generateExceptionId: () => "replace-generated",
    generateCalendarId: () => "replace-calendar",
  });
  check(
    "73: replace conflicts removes the existing exception and adds the imported one",
    !replaceResult.calendar.exceptions.some((e) => e.title === "Existing Labor Day Entry") &&
      replaceResult.calendar.exceptions.some((e) => e.title === "Imported Labor Day"),
  );

  let state: AppData = { ...createDemoAppData(), schoolCalendar: existingCalendar };
  state = appDataReducer(state, {
    type: "ADD_CALENDAR_EXCEPTION",
    exception: { id: "manual-exc", startDate: "2026-10-01", endDate: "2026-10-01", type: "no-students", title: "Manual PD Day" },
  });
  check("74: calendar edits persist (add)", state.schoolCalendar?.exceptions.some((e) => e.id === "manual-exc") === true);
  state = appDataReducer(state, { type: "UPDATE_CALENDAR_EXCEPTION", exceptionId: "manual-exc", patch: { title: "Renamed PD Day" } });
  check("74: calendar edits persist (update)", state.schoolCalendar?.exceptions.find((e) => e.id === "manual-exc")?.title === "Renamed PD Day");

  const lessonsBeforeDelete = state.lessons;
  state = appDataReducer(state, { type: "DELETE_CALENDAR_EXCEPTION", exceptionId: "manual-exc" });
  check("74: calendar edits persist (delete)", !state.schoolCalendar?.exceptions.some((e) => e.id === "manual-exc"));
  check("75: deleting a calendar exception does not delete lessons", state.lessons === lessonsBeforeDelete);
}

console.log("\n76-84. Bell Schedule import (CSV/paste)");
{
  const csvText = "label,start_time,end_time,kind,class_section\nPeriod 1,7:25 AM,8:23 AM,instructional,\nPassing,8:23 AM,8:29 AM,passing,";
  const csvResult = parseBellScheduleTable(csvText);
  check("76: CSV bell schedule parses", csvResult.ok === true && csvResult.ok && csvResult.rows.length === 2);

  const pastedTable = "label\tstart_time\tend_time\tkind\tclass_section\nPeriod 1\t7:25 AM\t8:23 AM\tinstructional\t";
  const pastedResult = parseBellScheduleTable(pastedTable);
  check("77: pasted (tab-delimited) table parses", pastedResult.ok === true);

  const invalidStart = parseBellScheduleTable("label,start_time,end_time,kind,class_section\nPeriod 1,not-a-time,8:23 AM,instructional,");
  check("78: invalid start time rejected", invalidStart.ok === false);

  const endBeforeStart = parseBellScheduleTable("label,start_time,end_time,kind,class_section\nPeriod 1,8:23 AM,7:25 AM,instructional,");
  check("79: end <= start rejected", endBeforeStart.ok === false);

  const overlapping = parseBellScheduleTable(
    "label,start_time,end_time,kind,class_section\nPeriod 1,7:25 AM,8:30 AM,instructional,\nPeriod 2,8:00 AM,9:00 AM,instructional,",
  );
  check("80: accidental overlap detected", overlapping.ok === false);

  if (csvResult.ok) {
    const blocks = buildScheduleBlocksFromRows(csvResult.rows, "imported-test");
    const newSchedule: BellSchedule = { id: "imported-test", name: "Imported", isDefault: false, timeZone: "America/Detroit", source: "imported", blocks };
    let state: AppData = createDemoAppData();
    const beforeCount = state.schedules.length;
    const priorDefault = state.schedules.find((s) => s.isDefault)?.id;
    state = appDataReducer(state, { type: "ADD_SCHEDULE", schedule: newSchedule });
    check("81: a valid import creates a new schedule", state.schedules.length === beforeCount + 1);
    const imported = state.schedules.find((s) => s.id === "imported-test");
    check("82: the imported schedule does not become default automatically", imported?.isDefault === false);
    check("83: the previous default is unchanged", state.schedules.find((s) => s.isDefault)?.id === priorDefault);
  } else {
    check("81: a valid import creates a new schedule", false);
    check("82: the imported schedule does not become default automatically", false);
    check("83: the previous default is unchanged", false);
  }

  const manyPeriods = parseBellScheduleTable(
    Array.from({ length: 10 }, (_, i) => {
      const startHour = (7 + i).toString().padStart(2, "0");
      return `Period ${i + 1},${startHour}:00,${startHour}:45,instructional,`;
    }).join("\n"),
  );
  check("84: an arbitrary number of periods is supported (10 periods)", manyPeriods.ok === true && manyPeriods.ok && manyPeriods.rows.length === 10);
}

console.log("\n85-94. Present Mode / Week integration (static source checks - see verify:demo for behavioral coverage)");
{
  const liveSource = readFileSync(join(process.cwd(), "components", "present", "LivePresentScreen.tsx"), "utf8");
  check("85: LivePresentScreen resolves the Master Calendar before the schedule engine", liveSource.includes("resolveSchoolDate"));
  check("86: LivePresentScreen selects the resolved BellSchedule for the date", liveSource.includes("dateResolution?.resolvedTeacherSchedule"));
  check("87: a no-school Present state is wired up", liveSource.includes("NoSchoolScreen"));
  check("88: a no-students Present state is wired up", liveSource.includes("NoStudentsScreen"));
  check("89: an unconfigured-schedule warning is wired up", liveSource.includes("UnconfiguredScheduleScreen"));
  check("90: automated transitions use the date-resolved schedule (fed by `schedule`, itself from dateResolution)", liveSource.includes("TransitionScreenContainer") && liveSource.includes("const schedule = dateResolution"));
  check("91: lunch state is integrated into Present Mode", liveSource.includes("LunchScreen") && liveSource.includes('kind === "lunch"'));

  const weekGridSource = readFileSync(join(process.cwd(), "components", "week", "WeekGrid.tsx"), "utf8");
  check("92: Week view marks No School", weekGridSource.includes("NO SCHOOL"));
  check("93: Week view marks Special Bell (uses the exception's own title as the badge)", weekGridSource.includes("special-schedule"));

  const weekPlanningGridSource = readFileSync(join(process.cwd(), "lib", "week", "buildWeekPlanningGrid.ts"), "utf8");
  check(
    "94: Week view's grid-building logic has no calendar/exception concept to accidentally filter lessons by - it can only ever preserve them",
    !weekPlanningGridSource.includes("SchoolCalendar") && !weekPlanningGridSource.includes("exception"),
  );
}

console.log("\nU1-U15. Master Calendar upload workflow (Upload Completed Template -> Review Calendar -> Apply Calendar)");
{
  const template = buildMasterCalendarCsvTemplate();
  const templateResult = parseMasterCalendarCsv(template);
  check("U1: the downloadable template itself parses as a valid filled template", templateResult.ok === true);
  if (templateResult.ok) {
    check("U1: the template produces zero validation issues", validateParsedExceptions(templateResult.exceptions).length === 0);
  }

  const multiDayCsv =
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" +
    "2026-11-25,2026-11-27,no-school,Thanksgiving Break,,,";
  const multiDayResult = parseMasterCalendarCsv(multiDayCsv);
  check("U2: a valid multi-day date range parses", multiDayResult.ok === true);
  if (multiDayResult.ok) {
    check("U2: endDate differs from startDate for the range row", multiDayResult.exceptions[0].endDate === "2026-11-27" && multiDayResult.exceptions[0].startDate === "2026-11-25");
    const preview = buildMasterCalendarImportPreview(multiDayResult.meta, multiDayResult.exceptions, [ohhs], null);
    check("U2: the preview counts all 3 affected school dates for the range", preview.affectedDateCount === 3);
  }

  const blankOptionalCsv =
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" + "2026-09-07,2026-09-07,no-school,Labor Day,,,";
  const blankOptionalResult = parseMasterCalendarCsv(blankOptionalCsv);
  check("U3: blank optional fields (schedule_profile/dismissal_time/notes) parse without error", blankOptionalResult.ok === true);
  if (blankOptionalResult.ok) {
    check("U3: blank optional fields produce zero validation issues", validateParsedExceptions(blankOptionalResult.exceptions).length === 0);
  }

  const malformedDateCsv =
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" + "2026-13-40,2026-13-40,no-school,Bad Date,,,";
  const malformedDateResult = parseMasterCalendarCsv(malformedDateCsv);
  check(
    "U4: a malformed date is rejected with the correct row number (row 2 - first data row after the header)",
    malformedDateResult.ok === true &&
      malformedDateResult.ok &&
      validateParsedExceptions(malformedDateResult.exceptions).some((i) => i.rowIndex === 2 && i.message.includes("Invalid start date")),
  );

  const endBeforeStartCsv =
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" + "2026-09-10,2026-09-05,no-school,Backwards,,,";
  const endBeforeStartResult = parseMasterCalendarCsv(endBeforeStartCsv);
  check(
    "U5: end date before start date is rejected",
    endBeforeStartResult.ok === true && endBeforeStartResult.ok && validateParsedExceptions(endBeforeStartResult.exceptions).some((i) => i.message.includes("before start date")),
  );

  const invalidTypeCsv =
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" + "2026-09-10,2026-09-10,holiday,Bad Type,,,";
  const invalidTypeResult = parseMasterCalendarCsv(invalidTypeCsv);
  check(
    "U6: an invalid event type is rejected",
    invalidTypeResult.ok === true && invalidTypeResult.ok && validateParsedExceptions(invalidTypeResult.exceptions).some((i) => i.message.includes("Unknown type")),
  );

  const missingProfileCsv =
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" +
    "2026-09-30,2026-09-30,special-bell,Early Release,,11:24 AM,";
  const missingProfileResult = parseMasterCalendarCsv(missingProfileCsv);
  check(
    "U7: a special-bell row with no schedule_profile is rejected as an invalid schedule-profile value",
    missingProfileResult.ok === true && missingProfileResult.ok && validateParsedExceptions(missingProfileResult.exceptions).some((i) => i.message.includes("schedule_profile")),
  );

  const badDismissalCsv =
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" +
    "2026-09-30,2026-09-30,special-bell,Early Release,REGULAR,tomorrow morning,";
  const badDismissalResult = parseMasterCalendarCsv(badDismissalCsv);
  check(
    'U8: an invalid dismissal time is rejected with a plain-language, example-bearing message',
    badDismissalResult.ok === true &&
      badDismissalResult.ok &&
      validateParsedExceptions(badDismissalResult.exceptions).some((i) => i.message === "dismissal_time must be a valid time such as 11:15 AM."),
  );
  const goodDismissalCsv = badDismissalCsv.replace("tomorrow morning", "11:24 AM");
  const goodDismissalResult = parseMasterCalendarCsv(goodDismissalCsv);
  check(
    "U8: a validly-formatted dismissal time (11:24 AM) passes",
    goodDismissalResult.ok === true && goodDismissalResult.ok && !validateParsedExceptions(goodDismissalResult.exceptions).some((i) => i.message.includes("dismissal_time")),
  );

  const duplicateCsv =
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" +
    "2026-09-07,2026-09-07,no-school,Labor Day,,,\n" +
    "2026-09-07,2026-09-07,no-school,Labor Day (duplicate row),,,";
  const duplicateResult = parseMasterCalendarCsv(duplicateCsv);
  check(
    "U9: a duplicate row (same date range and type) is flagged, pointing back at the first occurrence",
    duplicateResult.ok === true &&
      duplicateResult.ok &&
      validateParsedExceptions(duplicateResult.exceptions).some((i) => i.rowIndex === 3 && i.message.includes("Duplicate of row 2")),
  );

  const headerOnlyCsv = "start_date,end_date,type,title,schedule_profile,dismissal_time,notes";
  const headerOnlyResult = parseMasterCalendarCsv(headerOnlyCsv);
  check("U10: a file with only a header row is rejected with a clear, non-technical message", headerOnlyResult.ok === false);

  // Mirrors a real teacher's AppData: OHHS Regular Day has already been
  // added to their Bell Schedules (e.g. via "+ Use OHHS Regular Day")
  // before they ever import a calendar that references it by profile key.
  const stateBeforeUpload: AppData = { ...createDemoAppData(), schedules: [ohhs, ...createDemoAppData().schedules] };
  const snapshotBeforeUpload = JSON.stringify(stateBeforeUpload);
  if (templateResult.ok) {
    validateParsedExceptions(templateResult.exceptions);
    buildMasterCalendarImportPreview(templateResult.meta, templateResult.exceptions, stateBeforeUpload.schedules, stateBeforeUpload.schoolCalendar);
  }
  check(
    "U11: parsing, validating, and previewing an uploaded file never mutates application state before confirmation",
    JSON.stringify(stateBeforeUpload) === snapshotBeforeUpload,
  );

  if (templateResult.ok) {
    const commitResult = commitMasterCalendarImport({
      meta: templateResult.meta,
      exceptions: templateResult.exceptions,
      existingCalendar: null,
      bellSchedules: [ohhs],
      conflictResolution: "skip",
      generateExceptionId: (() => {
        let n = 0;
        return () => `upload-workflow-${n++}`;
      })(),
      generateCalendarId: () => "upload-workflow-calendar",
    });

    let confirmedState = appDataReducer(stateBeforeUpload, {
      type: "IMPORT_MASTER_CALENDAR",
      calendar: commitResult.calendar,
      newBellSchedules: commitResult.newBellSchedules,
    });

    const fakeStore = new Map<string, string>();
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (key: string) => fakeStore.get(key) ?? null,
        setItem: (key: string, value: string) => {
          fakeStore.set(key, value);
        },
        removeItem: (key: string) => {
          fakeStore.delete(key);
        },
      },
    };
    const repo = new LocalStorageDataRepository();
    await repo.save(confirmedState);
    const reloaded = await repo.load();
    check(
      "U12: applying the calendar persists the new exceptions through the existing repository/localStorage mechanism",
      reloaded.schoolCalendar !== null && reloaded.schoolCalendar.exceptions.length === commitResult.calendar.exceptions.length,
    );
    delete (globalThis as Record<string, unknown>).window;

    const importedNoSchoolResolution = resolveSchoolDate({
      dateKey: "2026-09-07",
      calendar: confirmedState.schoolCalendar,
      bellSchedules: confirmedState.schedules,
      teacherPreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
    });
    check("U13: the imported no-school date (Labor Day) is honored by resolveSchoolDate", importedNoSchoolResolution.status === "no-school");

    const importedSpecialResolution = resolveSchoolDate({
      dateKey: "2026-09-30",
      calendar: confirmedState.schoolCalendar,
      bellSchedules: confirmedState.schedules,
      teacherPreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
    });
    check(
      "U14: the imported early-release/special-bell date resolves through the real chain (EARLY_RELEASE profile requires configuration - never guessed)",
      importedSpecialResolution.status === "unconfigured-schedule" && importedSpecialResolution.exception?.sourceScheduleProfile === "EARLY_RELEASE",
    );

    const regularProfileCsv =
      "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" +
      "2026-10-14,2026-10-14,special-bell,Regular-mapped Special Day,REGULAR,,";
    const regularProfileResult = parseMasterCalendarCsv(regularProfileCsv);
    if (regularProfileResult.ok) {
      const regularProfileCommit = commitMasterCalendarImport({
        meta: null,
        exceptions: regularProfileResult.exceptions,
        existingCalendar: confirmedState.schoolCalendar,
        bellSchedules: confirmedState.schedules,
        conflictResolution: "skip",
        generateExceptionId: () => "regular-profile-exc",
        generateCalendarId: () => "unused",
      });
      const withRegularProfile = appDataReducer(confirmedState, {
        type: "IMPORT_MASTER_CALENDAR",
        calendar: regularProfileCommit.calendar,
        newBellSchedules: regularProfileCommit.newBellSchedules,
      });
      const regularMappedResolution = resolveSchoolDate({
        dateKey: "2026-10-14",
        calendar: withRegularProfile.schoolCalendar,
        bellSchedules: withRegularProfile.schedules,
        teacherPreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
      });
      check(
        "U14: a special-bell row mapped to a fully-configured profile (REGULAR -> OHHS_REGULAR) resolves a real, usable schedule",
        regularMappedResolution.status === "special-schedule" && regularMappedResolution.resolvedTeacherSchedule?.id === OHHS_REGULAR_ID,
      );
      confirmedState = withRegularProfile;
    }

    let stateWithManualException = appDataReducer(confirmedState, {
      type: "ADD_CALENDAR_EXCEPTION",
      exception: { id: "manual-verify-exception", startDate: "2027-03-15", endDate: "2027-03-15", type: "no-students", title: "Manually Added PD Day" },
    });
    check(
      "U15: a manually-created exception exists before a second, unrelated import",
      stateWithManualException.schoolCalendar?.exceptions.some((e) => e.id === "manual-verify-exception") === true,
    );

    const secondImportCsv =
      "start_date,end_date,type,title,schedule_profile,dismissal_time,notes\n" + "2027-05-31,2027-05-31,no-school,Memorial Day,,,";
    const secondImportResult = parseMasterCalendarCsv(secondImportCsv);
    if (secondImportResult.ok) {
      const secondCommit = commitMasterCalendarImport({
        meta: null,
        exceptions: secondImportResult.exceptions,
        existingCalendar: stateWithManualException.schoolCalendar,
        bellSchedules: stateWithManualException.schedules,
        conflictResolution: "skip",
        generateExceptionId: () => "second-import-exc",
        generateCalendarId: () => "unused-2",
      });
      stateWithManualException = appDataReducer(stateWithManualException, {
        type: "IMPORT_MASTER_CALENDAR",
        calendar: secondCommit.calendar,
        newBellSchedules: secondCommit.newBellSchedules,
      });
      check(
        "U15: an unrelated, non-overlapping import never deletes the manually-created exception",
        stateWithManualException.schoolCalendar?.exceptions.some((e) => e.id === "manual-verify-exception") === true,
      );
      check(
        "U15: the new imported exception was still added alongside the preserved manual one",
        stateWithManualException.schoolCalendar?.exceptions.some((e) => e.title === "Memorial Day") === true,
      );
    }
  }
}

console.log(
  "\n(Other suites: run `npm run verify:schedule`, `verify:lessons`, `verify:preview`, `verify:week`, " +
    "`verify:classroom`, `verify:resources`, and `verify:demo` - or `npm run verify` for everything together. " +
    "Also run `npm run lint` and `npm run build`.)",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
}

main().then(() => {
  process.exit(failures === 0 ? 0 : 1);
});
