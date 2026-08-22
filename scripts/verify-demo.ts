/**
 * Standalone verification for Demo Mode (Part 13-16): data isolation from
 * real AppData, the demo seed's content (real OHHS bell times, real
 * Master Calendar exceptions, populated lessons/resources/routines), and
 * that its Present Simulator scenarios actually exercise the real
 * calendar -> schedule -> Present Mode engine rather than being a static
 * slideshow. Pure logic plus targeted static-source checks (no DOM), like
 * the rest of this project's verify scripts.
 *
 *   npm run verify:demo
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDemoModeAppData } from "@/lib/data/demoModeData";
import { DemoDataRepository } from "@/lib/data/demoModeRepository";
import {
  DEMO_EARLY_RELEASE_DATE,
  DEMO_NO_SCHOOL_DATE,
  DEMO_NO_STUDENTS_DATE,
  DEMO_REGULAR_DATE,
} from "@/lib/data/demoScenarioDates";
import { DEMO_EARLY_RELEASE_ID } from "@/lib/schedule/presets/demoSpecialSchedules";
import { OHHS_REGULAR_ID } from "@/lib/schedule/presets/ohhsRegular";
import { resolveSchoolDate } from "@/lib/calendar/resolveSchoolDate";
import { resolveTeacherSchedule } from "@/lib/schedule/resolveTeacherSchedule";
import { getCurrentBlock } from "@/lib/schedule/getCurrentBlock";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
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

/** `time` is "HH:mm" or "HH:mm:ss" - seconds default to "00" if omitted. */
function atLocalTime(isoDate: string, time: string): Date {
  const withSeconds = time.split(":").length === 3 ? time : `${time}:00`;
  return new Date(`${isoDate}T${withSeconds}-04:00`);
}

async function main() {
const demoData = createDemoModeAppData();

console.log("\n95-98. Demo data isolation");
{
  const providerSource = readFileSync(join(process.cwd(), "lib", "store", "DemoAppDataProvider.tsx"), "utf8");
  check(
    "95: Demo Mode switches the data source to an isolated DemoDataRepository",
    providerSource.includes("DemoDataRepository") && providerSource.includes("repository={repository}"),
  );
  check(
    "95: DemoAppDataProvider never imports the real localStorage-backed repository singleton",
    !providerSource.includes('from "@/lib/data/localStorageRepository"'),
  );

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
  const demoRepo = new DemoDataRepository();
  await demoRepo.save({ ...demoData, teacherSchedulePreferences: { lunchWave: "A" } });
  check("96: saving through DemoDataRepository never writes to localStorage - real AppData is untouched", fakeStore.size === 0);
  delete (globalThis as Record<string, unknown>).window;

  const snapshotA = demoRepo.getInitialSnapshot();
  const freshDemoData = createDemoModeAppData();
  check(
    "97: demo edits do not mutate real data - each demo seed call produces an independent, deep-cloned object",
    snapshotA !== freshDemoData && snapshotA.courses !== freshDemoData.courses,
  );

  const shellSource = readFileSync(join(process.cwd(), "components", "demo", "DemoShell.tsx"), "utf8");
  check(
    '98: Exit Demo is a plain navigation back to the real app ("/") - real data was never touched, so nothing needs restoring',
    shellSource.includes('href="/"'),
  );
}

console.log("\n99-109. Demo seed content");
{
  check("99: Demo contains Algebra", demoData.courses.some((c) => c.name.includes("Algebra")));
  check("100: Demo contains Geometry", demoData.courses.some((c) => c.name.includes("Geometry")));
  check("101: Demo contains Enrichment", demoData.classSections.some((s) => s.name.includes("Enrichment")));
  check("102: Demo contains Prep", demoData.classSections.some((s) => s.name.includes("Prep")));
  check(
    "103: Demo contains OHHS Regular Day, marked default",
    demoData.schedules.some((s) => s.id === OHHS_REGULAR_ID && s.isDefault),
  );
  check(
    "104: Demo contains a special schedule example",
    demoData.schedules.some((s) => s.id === DEMO_EARLY_RELEASE_ID),
  );
  check("105: Demo contains Master Calendar exceptions", (demoData.schoolCalendar?.exceptions.length ?? 0) > 0);
  check("106: Demo contains populated lessons", demoData.lessons.length > 0);

  const fullyPopulated = demoData.lessons.filter(
    (lesson) =>
      lesson.learningTarget.trim().length > 0 &&
      lesson.agendaItems.length > 0 &&
      lesson.resources.length > 0 &&
      lesson.announcements.length > 0,
  );
  check(
    "107: at least one demo lesson populates all four Present Mode panels (target/agenda/resources/announcements)",
    fullyPopulated.length > 0,
  );
  check("108: Demo contains resources", demoData.libraryResources.length > 0);
  check("109: Demo contains arrival routines", demoData.classPresentationSettings.length > 0);
}

console.log("\n110-119. Demo Present Simulator scenarios (real engine, not a slideshow)");
{
  const ohhsRegular = demoData.schedules.find((s) => s.id === OHHS_REGULAR_ID)!;
  const teacherPrefs = demoData.teacherSchedulePreferences;

  const duringClassResolution = resolveSchoolDate({
    dateKey: DEMO_REGULAR_DATE,
    calendar: demoData.schoolCalendar,
    bellSchedules: demoData.schedules,
    teacherPreferences: teacherPrefs,
  });
  check(
    "110: Demo 'During Class' resolves to a regular day using an explicit simulated date - no dependency on the real wall clock",
    duringClassResolution.status === "regular",
  );

  const enrichmentState = getPresentationState(ohhsRegular, atLocalTime(DEMO_REGULAR_DATE, "09:35"));
  check(
    "111: Demo Enrichment resolves 9:35 correctly",
    enrichmentState.mode === "student-facing" && enrichmentState.block.kind === "enrichment",
  );

  const simulatorSource = readFileSync(join(process.cwd(), "components", "demo", "DemoPresentSimulator.tsx"), "utf8");
  check(
    "112: Demo Passing Period uses the real LivePresentScreen/TransitionScreen, not a separate mock",
    simulatorSource.includes("LivePresentScreen"),
  );

  const finalFiveState = getPresentationState(ohhsRegular, atLocalTime(DEMO_REGULAR_DATE, "09:18:23"));
  check(
    "113: Demo Final Five uses the actual countdown rule (4:37 remaining, well under the 5:00 threshold, so it's already visible)",
    finalFiveState.mode === "student-facing" && finalFiveState.showCountdown === true && finalFiveState.remainingSeconds === 4 * 60 + 37,
  );
  const justOverFiveState = getPresentationState(ohhsRegular, atLocalTime(DEMO_REGULAR_DATE, "09:17:59"));
  check(
    "113: the same exact >5:00-hidden rule still applies in the demo (5:01 remaining is hidden)",
    justOverFiveState.mode === "student-facing" && justOverFiveState.showCountdown === false,
  );

  const bResolved = resolveTeacherSchedule(ohhsRegular, { lunchWave: "B" });
  check("114: Demo B Lunch at 11:30 shows Lunch", getCurrentBlock(bResolved, atLocalTime(DEMO_REGULAR_DATE, "11:30"))?.kind === "lunch");
  const cResolved = resolveTeacherSchedule(ohhsRegular, { lunchWave: "C" });
  check(
    "115: Demo C Lunch at 11:30 shows Period 5 (C Lunch begins at 11:48)",
    getCurrentBlock(cResolved, atLocalTime(DEMO_REGULAR_DATE, "11:30"))?.kind === "instructional",
  );

  const earlyReleaseResolution = resolveSchoolDate({
    dateKey: DEMO_EARLY_RELEASE_DATE,
    calendar: demoData.schoolCalendar,
    bellSchedules: demoData.schedules,
    teacherPreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
  });
  check(
    "116: Demo Early Release resolves through the real calendar -> schedule chain to a usable schedule (not just a text card)",
    earlyReleaseResolution.status === "special-schedule" &&
      earlyReleaseResolution.bellSchedule?.id === DEMO_EARLY_RELEASE_ID &&
      (earlyReleaseResolution.resolvedTeacherSchedule?.blocks.length ?? 0) > 0,
  );

  const noSchoolResolution = resolveSchoolDate({
    dateKey: DEMO_NO_SCHOOL_DATE,
    calendar: demoData.schoolCalendar,
    bellSchedules: demoData.schedules,
    teacherPreferences: teacherPrefs,
  });
  check("117: Demo No School works", noSchoolResolution.status === "no-school");

  const noStudentsResolution = resolveSchoolDate({
    dateKey: DEMO_NO_STUDENTS_DATE,
    calendar: demoData.schoolCalendar,
    bellSchedules: demoData.schedules,
    teacherPreferences: teacherPrefs,
  });
  check("118: Demo No Students works", noStudentsResolution.status === "no-students");

  const endOfDayState = getPresentationState(ohhsRegular, atLocalTime(DEMO_REGULAR_DATE, "15:00"));
  check(
    "119: Demo End of Day works",
    endOfDayState.mode === "transition" && endOfDayState.nextStudentFacingBlock === null,
  );
}

console.log("\n120-121. Demo chrome (badge + Exit Demo)");
{
  const shellSource = readFileSync(join(process.cwd(), "components", "demo", "DemoShell.tsx"), "utf8");
  const simulatorSource = readFileSync(join(process.cwd(), "components", "demo", "DemoPresentSimulator.tsx"), "utf8");

  check("120: the Demo Mode badge is visible outside Present Mode", shellSource.includes("Demo Mode"));
  check("120: Present Mode itself also shows a small Demo Mode badge", simulatorSource.includes("Demo Mode"));

  check("121: Exit Demo is reachable outside Present Mode", shellSource.includes("Exit Demo"));
  check("121: Exit Demo is reachable from Present Mode too", simulatorSource.includes("Exit Demo"));
}

console.log(
  "\n(Other suites: run `npm run verify:schedule`, `verify:lessons`, `verify:preview`, `verify:week`, " +
    "`verify:classroom`, `verify:resources`, and `verify:calendar` - or `npm run verify` for everything " +
    "together. Also run `npm run lint` and `npm run build`.)",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
}

main().then(() => {
  process.exit(failures === 0 ? 0 : 1);
});
