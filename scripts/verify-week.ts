/**
 * Standalone verification for Phase 3's weekly planning workspace.
 * Companion to scripts/verify-schedule.ts, verify-lessons.ts, and
 * verify-preview.ts (`npm run verify` runs all four) - this script covers
 * what's new in `lib/week/*` and the Week grid's data model, plus brief
 * regression spot-checks confirming Phase 1/2/2.5 behavior is untouched.
 *
 * Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:week
 */

import { appDataReducer } from "@/lib/store/reducer";
import type { AppDataAction } from "@/lib/store/actions";
import { createLessonActions } from "@/lib/store/lessonActions";
import { createDemoAppData, DEMO_SCHEDULES } from "@/lib/data/demoData";
import { findLessonForSection, getCopyDestinationSections } from "@/lib/data/lessons";
import { addDaysToDateKey, getLocalDateKey, weekdayForDateKey } from "@/lib/schedule/localDate";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { resolvePreviewClassroomProps } from "@/lib/present/resolvePreviewClassroomProps";
import { getWeekStart } from "@/lib/week/getWeekStart";
import { getWeekDates } from "@/lib/week/getWeekDates";
import { addWeeksToDateKey } from "@/lib/week/addWeeksToDateKey";
import { formatWeekRange } from "@/lib/week/formatWeekRange";
import { getLessonPlanningStatus } from "@/lib/week/getLessonPlanningStatus";
import { buildWeekPlanningGrid } from "@/lib/week/buildWeekPlanningGrid";
import { copyWeekForward, planCopyWeekForward } from "@/lib/week/copyWeekForward";
import { buildLessonEditUrl, buildPreviewUrl } from "@/lib/week/weekLinks";
import type { AppData } from "@/lib/data/types";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

function parseParams(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams;
}

const schedule = DEMO_SCHEDULES.find((s) => s.id === "schedule-demo-standard")!;
function atLocalTime(isoDate: string, hhmm: string): Date {
  return new Date(`${isoDate}T${hhmm}:00-04:00`);
}

let state: AppData = { ...createDemoAppData(), lessons: [] };
function dispatch(action: AppDataAction) {
  state = appDataReducer(state, action);
}
function actions() {
  return createLessonActions(state, dispatch);
}

console.log("1. Week starts Monday");
{
  check("a Wednesday resolves to that week's Monday", getWeekStart("2026-08-19") === "2026-08-17");
  check("a Monday resolves to itself", getWeekStart("2026-08-17") === "2026-08-17");
  check(
    "a Sunday resolves to the preceding Monday (ISO-style: Sunday ends a week, not starts one)",
    getWeekStart("2026-08-23") === "2026-08-17",
  );
}

console.log("\n2. Week returns exactly Monday-Friday planning dates");
{
  const dates = getWeekDates("2026-08-19"); // normalizes from a mid-week date
  check("exactly 5 dates", dates.length === 5);
  check("starts Monday", dates[0] === "2026-08-17");
  check("ends Friday", dates[4] === "2026-08-21");
  check(
    "weekdays are Mon..Fri in order",
    dates.map(weekdayForDateKey).join(",") === "monday,tuesday,wednesday,thursday,friday",
  );
}

console.log("\n3. Previous/next week arithmetic across month boundaries");
{
  const monday = "2026-08-31";
  check("2026-08-31 is a Monday", weekdayForDateKey(monday) === "monday");
  const nextWeek = addWeeksToDateKey(monday, 1);
  check("next week crosses Aug -> Sep correctly", nextWeek === "2026-09-07");
  check("previous-week arithmetic is the exact inverse", addWeeksToDateKey(nextWeek, -1) === monday);
  const dates = getWeekDates(monday);
  check("the week itself spans Aug 31 - Sep 4", dates[0] === "2026-08-31" && dates[4] === "2026-09-04");
}

console.log("\n4. Week arithmetic across year boundaries");
{
  const monday = "2026-12-28";
  check("2026-12-28 is a Monday", weekdayForDateKey(monday) === "monday");
  const nextWeek = addWeeksToDateKey(monday, 1);
  check("next week crosses 2026 -> 2027 correctly", nextWeek === "2027-01-04");
  const dates = getWeekDates(monday);
  check("the week itself spans Dec 28 - Jan 1", dates[0] === "2026-12-28" && dates[4] === "2027-01-01");
}

console.log("\n5. Current school-local date highlights the correct day");
{
  const today = "2026-08-19"; // a Wednesday
  const dates = getWeekDates(getWeekStart(today));
  check("today is present in its own week's dates", dates.includes(today));
  check("today lands at the Wednesday-aligned index (2)", dates.indexOf(today) === 2);

  // 22:30 EDT the evening before, expressed as a UTC instant - must not
  // read as the UTC calendar date.
  const lateEveningUtc = new Date("2026-08-19T02:30:00Z");
  check(
    "the current date is computed school-local, not from UTC",
    getLocalDateKey(lateEveningUtc, "America/Detroit") === "2026-08-18",
  );
}

console.log("\n6. Grid includes all selected class sections");
{
  const grid = buildWeekPlanningGrid({
    weekStart: "2026-08-17",
    classSections: state.classSections,
    courses: state.courses,
    lessons: state.lessons,
    schedule,
  });
  check("one row per class section", grid.rows.length === state.classSections.length);
  check(
    "every class section appears exactly once",
    state.classSections.every((s) => grid.rows.filter((r) => r.classSection.id === s.id).length === 1),
  );
  check("every row has exactly 5 cells (Mon-Fri)", grid.rows.every((r) => r.cells.length === 5));
}

console.log("\n7. Filter by courseId works");
{
  const algebraSections = state.classSections.filter((s) => s.courseId === "course-algebra-1");
  const grid = buildWeekPlanningGrid({
    weekStart: "2026-08-17",
    classSections: algebraSections,
    courses: state.courses,
    lessons: state.lessons,
    schedule,
  });
  check("filtered grid contains only the chosen course's sections", grid.rows.every((r) => r.classSection.courseId === "course-algebra-1"));
  check(
    "filtered grid's row count matches the course's section count",
    grid.rows.length === algebraSections.length && algebraSections.length > 0,
  );
}

console.log("\n8-10. Missing / draft / prepared lesson status");
{
  check("no lesson -> missing", getLessonPlanningStatus(null) === "missing");

  actions().createLesson("2026-08-17", "section-geometry-p2");
  const blank = findLessonForSection(state.lessons, "2026-08-17", "section-geometry-p2");
  check("a blank DailyLesson (no content) -> draft", getLessonPlanningStatus(blank) === "draft");

  actions().updateLearningTarget("2026-08-17", "section-geometry-p2", "Now has a target");
  const preparedByTarget = findLessonForSection(state.lessons, "2026-08-17", "section-geometry-p2");
  check("a non-empty learning target alone -> prepared", getLessonPlanningStatus(preparedByTarget) === "prepared");

  actions().addAgendaItem("2026-08-17", "section-algebra-1-p4", "Agenda only");
  const preparedByAgenda = findLessonForSection(state.lessons, "2026-08-17", "section-algebra-1-p4");
  check(
    "an agenda item alone (empty learning target) -> prepared",
    getLessonPlanningStatus(preparedByAgenda) === "prepared" && preparedByAgenda?.learningTarget === "",
  );

  actions().addResource("2026-08-18", "section-algebra-1-p4", { title: "R", url: "https://example.com", type: "link" });
  check(
    "a resource alone -> prepared",
    getLessonPlanningStatus(findLessonForSection(state.lessons, "2026-08-18", "section-algebra-1-p4")) === "prepared",
  );

  actions().addAnnouncement("2026-08-19", "section-algebra-1-p4", "Note");
  check(
    "an announcement alone -> prepared",
    getLessonPlanningStatus(findLessonForSection(state.lessons, "2026-08-19", "section-algebra-1-p4")) === "prepared",
  );
}

console.log("\n11. Agenda completion summary is correct");
{
  const date = "2026-08-20";
  const section = "section-algebra-1-p1";
  actions().addAgendaItem(date, section, "Item A");
  actions().addAgendaItem(date, section, "Item B");
  actions().addAgendaItem(date, section, "Item C");
  const lesson = findLessonForSection(state.lessons, date, section)!;

  const gridBefore = buildWeekPlanningGrid({
    weekStart: getWeekStart(date),
    classSections: [state.classSections.find((s) => s.id === section)!],
    courses: state.courses,
    lessons: state.lessons,
    schedule,
  });
  const cellBefore = gridBefore.rows[0].cells.find((c) => c.date === date)!;
  check("0 of 3 complete before any toggles", cellBefore.agendaCompletion?.completed === 0 && cellBefore.agendaCompletion?.total === 3);

  actions().toggleAgendaItemCompleted(date, section, lesson.agendaItems[0].id);
  actions().toggleAgendaItemCompleted(date, section, lesson.agendaItems[1].id);

  const gridAfter = buildWeekPlanningGrid({
    weekStart: getWeekStart(date),
    classSections: [state.classSections.find((s) => s.id === section)!],
    courses: state.courses,
    lessons: state.lessons,
    schedule,
  });
  const cellAfter = gridAfter.rows[0].cells.find((c) => c.date === date)!;
  check("2 of 3 complete after toggling two items", cellAfter.agendaCompletion?.completed === 2 && cellAfter.agendaCompletion?.total === 3);

  const cellWithoutAgenda = gridAfter.rows[0].cells.find((c) => c.date !== date)!;
  check("a lesson with no agenda items has a null summary, not 0/0", cellWithoutAgenda.agendaCompletion === null);
}

console.log("\n12. Existing lesson navigates to the correct edit URL");
{
  const url = buildLessonEditUrl("2026-08-17", "section-algebra-1-p1");
  const params = parseParams(url);
  check("edit URL points at /lessons", url.startsWith("/lessons?"));
  check("edit URL carries the right date", params.get("date") === "2026-08-17");
  check("edit URL carries the right section", params.get("section") === "section-algebra-1-p1");
}

console.log("\n13. Preview URL contains the correct date and section");
{
  const withBlock = buildPreviewUrl("2026-08-20", "section-sat-prep-thursday", "block-enrichment:thursday");
  const paramsWithBlock = parseParams(withBlock);
  check("preview URL points at /present in preview mode", withBlock.startsWith("/present?") && paramsWithBlock.get("mode") === "preview");
  check("preview URL carries the right date", paramsWithBlock.get("date") === "2026-08-20");
  check("preview URL carries the right section", paramsWithBlock.get("section") === "section-sat-prep-thursday");
  check("preview URL carries the block id when one was resolved", paramsWithBlock.get("block") === "block-enrichment:thursday");

  const withoutBlock = buildPreviewUrl("2026-08-22", "section-algebra-1-p1");
  check("preview URL omits block when none was resolved (falls back to the generic block)", parseParams(withoutBlock).get("block") === null);
}

console.log("\n14. A missing lesson can be created");
{
  const date = "2026-08-21";
  const section = "section-geometry-p6";
  check("no lesson exists yet", findLessonForSection(state.lessons, date, section) === null);
  const created = actions().createLesson(date, section);
  check("createLesson returns a lesson for the right date/section", created.date === date && created.classSectionId === section);
  const found = findLessonForSection(state.lessons, date, section);
  check("the cell now reads back as draft, not missing", found !== null && getLessonPlanningStatus(found) === "draft");
}

console.log("\n15-16. Copy Next Day: independent deep copy, refuses silent overwrite");
{
  const date = "2026-09-14";
  const section = "section-algebra-1-p1";
  actions().updateLearningTarget(date, section, "Week copy-next-day source");
  actions().addAgendaItem(date, section, "Step 1");
  const source = findLessonForSection(state.lessons, date, section)!;

  const result = actions().copyLessonToTomorrow(source.id);
  check("15: Copy Next Day succeeds against an empty destination", result === "copied");
  const nextDay = addDaysToDateKey(date, 1);
  const copy = findLessonForSection(state.lessons, nextDay, section);
  check("15: the copy exists on the next calendar day", copy !== null);
  check("15: the copy is independent (different lesson id)", copy?.id !== source.id);
  check("15: the copy's agenda item has a fresh id", copy?.agendaItems[0]?.id !== source.agendaItems[0]?.id);

  actions().updateLearningTarget(nextDay, section, "Manually edited destination");
  const conflictResult = actions().copyLessonToTomorrow(source.id);
  check("16: Copy Next Day refuses to overwrite silently", conflictResult === "conflict");
  const stillManual = findLessonForSection(state.lessons, nextDay, section);
  check("16: the destination is untouched after the refused copy", stillManual?.learningTarget === "Manually edited destination");
}

console.log("\n17. Same-course copy destinations exclude cross-course sections");
{
  const destinations = getCopyDestinationSections(state.classSections, "section-algebra-1-p1");
  check("a same-course section is offered", destinations.some((s) => s.id === "section-algebra-1-p4"));
  check("a cross-course section is excluded", !destinations.some((s) => s.id === "section-geometry-p2"));
}

console.log("\n18. Copy Previous Day only available when the source exists");
{
  const date = "2026-09-16";
  const section = "section-algebra-1-p4";
  const previousDate = addDaysToDateKey(date, -1);

  check("no lesson on the previous day yet - the shortcut would be hidden", findLessonForSection(state.lessons, previousDate, section) === null);

  actions().updateLearningTarget(previousDate, section, "Previous day source");
  const previousLesson = findLessonForSection(state.lessons, previousDate, section);
  check("a lesson on the previous day now exists - the shortcut would be shown", previousLesson !== null);

  const copyResult = actions().copyLessonToSection(previousLesson!.id, section, date);
  check("Copy Previous Day copies into the missing cell", copyResult === "copied");
  check(
    "the destination now has the previous day's content",
    findLessonForSection(state.lessons, date, section)?.learningTarget === "Previous day source",
  );
}

console.log("\n19-22. Copy Week Forward: plan, deep copy, conflict detection, non-conflicting-only");
{
  const weekStart = "2026-10-05";
  check("2026-10-05 is a Monday", weekdayForDateKey(weekStart) === "monday");
  const weekDates = getWeekDates(weekStart);
  const sectionA = "section-algebra-1-p1";
  const sectionB = "section-geometry-p2";

  actions().updateLearningTarget(weekDates[0], sectionA, "A Monday");
  actions().addAgendaItem(weekDates[0], sectionA, "A Monday agenda");
  actions().updateLearningTarget(weekDates[2], sectionA, "A Wednesday");
  actions().updateLearningTarget(weekDates[0], sectionB, "B Monday");

  // Pre-seed one destination conflict: sectionA's Tuesday, one week later.
  const destinationTuesday = addDaysToDateKey(weekDates[1], 7);
  actions().updateLearningTarget(destinationTuesday, sectionA, "Pre-existing destination lesson");
  actions().updateLearningTarget(weekDates[1], sectionA, "A Tuesday (will conflict)");

  const plan = planCopyWeekForward({ weekStart, classSectionIds: [sectionA, sectionB], lessons: state.lessons });

  check("19: destination week is exactly source week + 7 days", plan.destinationWeekStart === addWeeksToDateKey(weekStart, 1));
  check(
    "19: every planned item's destination date is its source date + 7 days",
    [...plan.toCopy, ...plan.conflicts].every((item) => addDaysToDateKey(item.sourceDate, 7) === item.destinationDate),
  );
  check("21: conflicts are detected before any mutation - exactly 1 conflict, 3 clean copies", plan.conflicts.length === 1 && plan.toCopy.length === 3);
  check(
    "21: the detected conflict is sectionA's Tuesday",
    plan.conflicts[0].classSectionId === sectionA && plan.conflicts[0].destinationDate === destinationTuesday,
  );

  const conflictBefore = findLessonForSection(state.lessons, destinationTuesday, sectionA);
  const cleanResult = copyWeekForward(plan, "non-conflicting-only", actions().copyLessonToSection);
  check("22: non-conflicting-only copies exactly the 3 clean items", cleanResult.copied === 3);
  check("22: non-conflicting-only skips the 1 conflict", cleanResult.skipped === 1);

  const mondayDestLesson = findLessonForSection(state.lessons, addDaysToDateKey(weekDates[0], 7), sectionA);
  check("20: a clean copy exists at its destination", mondayDestLesson !== null);
  check(
    "20: the copy is a deep, independent copy (fresh nested agenda id)",
    mondayDestLesson?.agendaItems[0]?.id !== findLessonForSection(state.lessons, weekDates[0], sectionA)?.agendaItems[0]?.id,
  );

  const conflictAfter = findLessonForSection(state.lessons, destinationTuesday, sectionA);
  check(
    "22: the conflicting destination lesson is completely untouched",
    conflictAfter?.id === conflictBefore?.id && conflictAfter?.learningTarget === conflictBefore?.learningTarget,
  );
}

console.log("\n23. Replace Conflicts and Copy All overwrites only after explicit confirmation/mode");
{
  // Derived (not hardcoded) 10 weeks after test 19-22's week - guaranteed
  // both a Monday (addWeeksToDateKey preserves weekday) and far enough
  // from every other test's dates that test 19-22's "non-conflicting-only"
  // copies (which land one week after ITS source week) can't bleed in.
  const weekStart = addWeeksToDateKey("2026-10-05", 10);
  const weekDates = getWeekDates(weekStart);
  const section = "section-algebra-1-p1";

  actions().updateLearningTarget(weekDates[0], section, "Fresh source content");
  const destinationDate = addDaysToDateKey(weekDates[0], 7);
  actions().updateLearningTarget(destinationDate, section, "Old destination content");

  const plan = planCopyWeekForward({ weekStart, classSectionIds: [section], lessons: state.lessons });
  check("the plan detects the single conflict and proposes no clean copies", plan.conflicts.length === 1 && plan.toCopy.length === 0);

  const result = copyWeekForward(plan, "replace-conflicts", actions().copyLessonToSection);
  check("replace-conflicts reports the overwrite as copied", result.copied === 1);
  const destinationAfter = findLessonForSection(state.lessons, destinationDate, section);
  check("the destination now reflects the source content after explicit replace", destinationAfter?.learningTarget === "Fresh source content");
}

console.log("\n24-26. Phase 1 / 2 / 2.5 regression spot-checks");
{
  const monday = getPresentationState(schedule, atLocalTime("2026-08-17", "08:10"));
  check("24: Phase 1 - Period 1 still resolves to student-facing", monday.mode === "student-facing");

  const thursday = getPresentationState(schedule, atLocalTime("2026-08-20", "09:55"));
  check(
    "24: Phase 1 - the Thursday override still resolves to the SAT Prep section",
    thursday.mode === "student-facing" && thursday.block.classSectionId === "section-sat-prep-thursday",
  );

  actions().updateLearningTarget("2026-11-02", "section-algebra-1-p1", "Regression check target");
  check(
    "25: Phase 2 - lesson lookup still works",
    findLessonForSection(state.lessons, "2026-11-02", "section-algebra-1-p1")?.learningTarget === "Regression check target",
  );

  const preview = resolvePreviewClassroomProps({
    date: "2026-08-22",
    classSectionId: "section-algebra-1-p1",
    block: null,
    lessons: state.lessons,
  });
  check("26: Phase 2.5 - Preview still never shows a fake countdown", preview?.showCountdown === false);
}

console.log("\nExtra: formatWeekRange matches the expected human-readable form");
{
  check('a normal week: "August 17–21, 2026"', formatWeekRange("2026-08-17") === "August 17–21, 2026");
  check('a month-crossing week: "August 31 – September 4, 2026"', formatWeekRange("2026-08-31") === "August 31 – September 4, 2026");
  check(
    'a year-crossing week: "December 28, 2026 – January 1, 2027"',
    formatWeekRange("2026-12-28") === "December 28, 2026 – January 1, 2027",
  );
}

console.log(
  "\n(27-29: run `npm run verify:schedule`, `npm run verify:lessons`, and `npm run verify:preview` - " +
    "or `npm run verify` for everything together. 30-31: `npm run lint` and `npm run build`.)",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
