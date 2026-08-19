/**
 * Standalone verification for Phase 2.5's Present Mode Preview. Companion
 * to scripts/verify-schedule.ts and scripts/verify-lessons.ts (`npm run
 * verify` runs all three) - this script only tests what's new: that Live
 * Mode's schedule engine is untouched, and that Preview Mode's lesson
 * resolution (`resolvePreviewClassroomProps`) works independently of the
 * live wall clock, including for Enrichment and the Thursday SAT Prep
 * override.
 *
 * Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:preview
 */

import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { resolveScheduleForWeekday } from "@/lib/schedule/resolveBlockOverride";
import { weekdayForDateKey } from "@/lib/schedule/localDate";
import { genericPreviewBlock, resolvePreviewClassroomProps } from "@/lib/present/resolvePreviewClassroomProps";
import { createDemoAppData, DEMO_SCHEDULES } from "@/lib/data/demoData";
import { appDataReducer } from "@/lib/store/reducer";
import type { AppDataAction } from "@/lib/store/actions";
import { createLessonActions } from "@/lib/store/lessonActions";
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

console.log("1. Live Mode is unaffected by Preview's existence");
{
  // Re-confirms the schedule engine Live Mode depends on - same functions
  // Preview also calls, never modified to support it.
  const monday = getPresentationState(schedule, atLocalTime("2026-08-17", "08:10"));
  check("Live: Period 1 still resolves to student-facing", monday.mode === "student-facing");

  const thursday = getPresentationState(schedule, atLocalTime("2026-08-20", "09:55"));
  check(
    "Live: the Thursday override still resolves to the SAT Prep section",
    thursday.mode === "student-facing" && thursday.block.classSectionId === "section-sat-prep-thursday",
  );
}

console.log("\n2. Preview works outside school hours (late at night - Live has nothing left to show)");
{
  const lateNightDate = "2026-08-17"; // a Monday, but 11pm - after every block has ended for the day
  const liveState = getPresentationState(schedule, atLocalTime(lateNightDate, "23:00"));
  check("Live Mode is in transition, with nothing more scheduled today", liveState.mode === "transition");
  if (liveState.mode === "transition") {
    check("no next student-facing block remains this late", liveState.nextStudentFacingBlock === null);
  }

  actions().updateLearningTarget(lateNightDate, "section-algebra-1-p1", "Late-night preview target");
  const preview = resolvePreviewClassroomProps({
    date: lateNightDate,
    classSectionId: "section-algebra-1-p1",
    block: null,
    lessons: state.lessons,
  });
  check(
    "Preview still resolves the lesson even though Live has nothing left to show",
    preview?.lesson?.learningTarget === "Late-night preview target",
  );
}

console.log("\n3. Arbitrary date selectable");
{
  const farFuture = "2027-03-15";
  actions().updateLearningTarget(farFuture, "section-geometry-p2", "Far future preview target");
  const preview = resolvePreviewClassroomProps({
    date: farFuture,
    classSectionId: "section-geometry-p2",
    block: null,
    lessons: state.lessons,
  });
  check("a date far outside any normal range still previews correctly", preview?.lesson?.learningTarget === "Far future preview target");
}

console.log("\n4. Arbitrary class section selectable");
{
  const date = "2026-10-01";
  actions().updateLearningTarget(date, "section-algebra-1-p4", "Target for Algebra P4");
  actions().updateLearningTarget(date, "section-prep", "Target for Prep");

  const previewA = resolvePreviewClassroomProps({ date, classSectionId: "section-algebra-1-p4", block: null, lessons: state.lessons });
  const previewB = resolvePreviewClassroomProps({ date, classSectionId: "section-prep", block: null, lessons: state.lessons });
  check("previewing one section returns that section's own lesson", previewA?.lesson?.learningTarget === "Target for Algebra P4");
  check("previewing a different section returns its own, different lesson", previewB?.lesson?.learningTarget === "Target for Prep");
}

console.log("\n5. Lesson content appears correctly in Preview");
{
  const date = "2026-11-02";
  const section = "section-algebra-1-p1";
  actions().updateLearningTarget(date, section, "Full content target");
  actions().addAgendaItem(date, section, "Agenda A");
  actions().addResource(date, section, { title: "Resource A", url: "https://example.com", type: "video" });
  actions().addAnnouncement(date, section, "Announcement A");

  const preview = resolvePreviewClassroomProps({ date, classSectionId: section, block: null, lessons: state.lessons });
  check("learning target passes through unchanged", preview?.lesson?.learningTarget === "Full content target");
  check("agenda passes through unchanged", preview?.lesson?.agendaItems.length === 1 && preview?.lesson?.agendaItems[0].title === "Agenda A");
  check("resources pass through unchanged", preview?.lesson?.resources.length === 1 && preview?.lesson?.resources[0].type === "video");
  check("announcements pass through unchanged", preview?.lesson?.announcements.length === 1);
}

console.log("\n6. No-lesson state works in Preview");
{
  const preview = resolvePreviewClassroomProps({
    date: "2099-12-31",
    classSectionId: "section-algebra-1-p1",
    block: null,
    lessons: state.lessons,
  });
  check("lesson is null for an unprepared date (not a fake lesson)", preview?.lesson === null);
  check(
    "the no-lesson message names the previewed date, not a generic 'today'",
    !!preview?.noLessonMessage.includes("2099") && !preview?.noLessonMessage.toLowerCase().includes("today"),
  );
}

console.log("\n7. Preview never shows the final-five-minute countdown");
{
  const preview = resolvePreviewClassroomProps({
    date: "2026-08-17",
    classSectionId: "section-algebra-1-p1",
    block: null,
    lessons: state.lessons,
  });
  check("showCountdown is always false in Preview", preview?.showCountdown === false);
  check("remainingSeconds is always 0 in Preview (nothing live to count down)", preview?.remainingSeconds === 0);
}

console.log("\n8. Enrichment can be previewed");
{
  const date = "2026-08-24"; // a Monday, not Thursday - Enrichment is not overridden
  check("2026-08-24 is a Monday", weekdayForDateKey(date) === "monday");

  actions().updateLearningTarget(date, "section-enrichment-open", "Enrichment preview target");
  const blocksForDay = resolveScheduleForWeekday(schedule, weekdayForDateKey(date)).filter(
    (block) => block.classSectionId === "section-enrichment-open",
  );
  check("the Enrichment block resolves for this Monday, unaltered", blocksForDay.some((b) => b.kind === "enrichment"));

  const preview = resolvePreviewClassroomProps({
    date,
    classSectionId: "section-enrichment-open",
    block: blocksForDay[0] ?? null,
    lessons: state.lessons,
  });
  check("Enrichment's lesson previews correctly", preview?.lesson?.learningTarget === "Enrichment preview target");
}

console.log("\n9. SAT Prep can be previewed through the Thursday override");
{
  const date = "2026-08-27"; // a Thursday
  check("2026-08-27 is a Thursday", weekdayForDateKey(date) === "thursday");

  actions().updateLearningTarget(date, "section-sat-prep-thursday", "SAT Prep preview target");
  const blocksForDay = resolveScheduleForWeekday(schedule, weekdayForDateKey(date)).filter(
    (block) => block.classSectionId === "section-sat-prep-thursday",
  );
  check(
    "the override-resolved SAT Prep block is offered for this Thursday",
    blocksForDay.some((b) => b.isOverridden && b.label === "SAT Prep"),
  );

  const preview = resolvePreviewClassroomProps({
    date,
    classSectionId: "section-sat-prep-thursday",
    block: blocksForDay[0] ?? null,
    lessons: state.lessons,
  });
  check(
    "SAT Prep's lesson previews correctly - no day-specific SAT logic needed in the lookup itself",
    preview?.lesson?.learningTarget === "SAT Prep preview target",
  );
  check(
    "the previewed block shows SAT Prep's real label/kind, not the generic placeholder",
    preview?.block.label === "SAT Prep" && preview?.block.kind === "instructional",
  );
}

console.log("\nExtra: the generic preview block never claims a real schedule kind");
{
  const block = genericPreviewBlock("section-algebra-1-p1");
  check('generic block kind is "custom", never a real BlockKind like "instructional"', block.kind === "custom");
  check('generic block reads "Preview" rather than pretending to be a class', block.customKindLabel === "Preview");
}

console.log(
  "\n(Schedule and lesson verification: run `npm run verify:schedule` and `npm run verify:lessons` - " +
    "or `npm run verify` for all three together.)",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
