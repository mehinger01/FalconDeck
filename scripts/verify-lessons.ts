/**
 * Standalone verification for Phase 2's Daily Lesson System. Companion to
 * scripts/verify-schedule.ts (run both - `npm run verify` - since this
 * script does not re-test the schedule engine itself, only the places
 * lessons touch it: current-block lookup, Enrichment, the Thursday SAT
 * Prep override, and the exact-5:00 countdown boundary).
 *
 * Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:lessons
 *
 * The lesson-action layer (`createLessonActions`) is plain functions over
 * plain data, so it's exercised here exactly as AppDataProvider exercises
 * it in the browser: dispatch through the real reducer, then re-derive a
 * fresh `actions` object from the latest state before each call - matching
 * how a new `useMemo(..., [data])` closure is created on every render.
 */

import { appDataReducer } from "@/lib/store/reducer";
import type { AppDataAction } from "@/lib/store/actions";
import { createLessonActions } from "@/lib/store/lessonActions";
import { createDemoAppData, DEMO_SCHEDULES } from "@/lib/data/demoData";
import { findLessonForSection, getCopyDestinationSections } from "@/lib/data/lessons";
import { addDaysToDateKey, getLocalDateKey } from "@/lib/schedule/localDate";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { shouldShowCountdown } from "@/lib/schedule/getRemainingTime";
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

// Start from demo data (real courses/sections) but with a blank lessons
// list, so every check below is self-contained and doesn't depend on
// today's date matching the seeded demo lessons.
let state: AppData = { ...createDemoAppData(), lessons: [] };
function dispatch(action: AppDataAction) {
  state = appDataReducer(state, action);
}
/** Fresh actions bound to the latest `state`, mirroring a new render's `useMemo`. */
function actions() {
  return createLessonActions(state, dispatch);
}

const schedule = DEMO_SCHEDULES.find((s) => s.id === "schedule-demo-standard")!;
const MONDAY = "2026-08-17";
const THURSDAY = "2026-08-20";
function atLocalTime(isoDate: string, hhmm: string): Date {
  return new Date(`${isoDate}T${hhmm}:00-04:00`);
}

console.log("1. Lesson unique by date + section");
{
  const date = MONDAY;
  const section = "section-algebra-1-p1";
  actions().updateLearningTarget(date, section, "First target");
  actions().updateLearningTarget(date, section, "Second target");
  const matches = state.lessons.filter((l) => l.date === date && l.classSectionId === section);
  check("exactly one lesson exists for this date+section", matches.length === 1);
  check("second write wins (update, not a duplicate)", matches[0].learningTarget === "Second target");
}

console.log("\n2. Learning target persists");
{
  const found = findLessonForSection(state.lessons, MONDAY, "section-algebra-1-p1");
  check("learning target readable via lookup", found?.learningTarget === "Second target");
}

console.log("\n3. Agenda CRUD + reorder");
{
  const date = MONDAY;
  const section = "section-algebra-1-p1";
  actions().addAgendaItem(date, section, "Item 1");
  actions().addAgendaItem(date, section, "Item 2");
  actions().addAgendaItem(date, section, "Item 3");
  let lesson = findLessonForSection(state.lessons, date, section)!;
  check("3 agenda items added", lesson.agendaItems.length === 3);

  const item2Id = lesson.agendaItems.find((i) => i.title === "Item 2")!.id;
  actions().updateAgendaItem(date, section, item2Id, { title: "Item 2 Edited", details: "extra detail" });
  lesson = findLessonForSection(state.lessons, date, section)!;
  const edited = lesson.agendaItems.find((i) => i.id === item2Id)!;
  check("agenda item edit persists", edited.title === "Item 2 Edited" && edited.details === "extra detail");

  actions().reorderAgendaItem(date, section, item2Id, "up");
  lesson = findLessonForSection(state.lessons, date, section)!;
  const sorted = [...lesson.agendaItems].sort((a, b) => a.sortOrder - b.sortOrder);
  check("reorder moved item earlier", sorted[0].id === item2Id);

  const item3Id = lesson.agendaItems.find((i) => i.title === "Item 3")!.id;
  actions().deleteAgendaItem(date, section, item3Id);
  lesson = findLessonForSection(state.lessons, date, section)!;
  check("delete removes the item (2 remain)", lesson.agendaItems.length === 2);
  const resequenced = [...lesson.agendaItems].sort((a, b) => a.sortOrder - b.sortOrder);
  check(
    "remaining sortOrder values are resequenced 0..n-1",
    resequenced.every((item, i) => item.sortOrder === i),
  );
}

console.log("\n4. Resources CRUD");
{
  const date = MONDAY;
  const section = "section-algebra-1-p1";
  actions().addResource(date, section, { title: "Doc", url: "https://example.com/doc", type: "document" });
  let lesson = findLessonForSection(state.lessons, date, section)!;
  check("resource added", lesson.resources.length === 1 && lesson.resources[0].type === "document");

  const resourceId = lesson.resources[0].id;
  actions().updateResource(date, section, resourceId, { title: "Doc Updated", type: "slides" });
  lesson = findLessonForSection(state.lessons, date, section)!;
  check(
    "resource update persists",
    lesson.resources[0].title === "Doc Updated" && lesson.resources[0].type === "slides",
  );

  actions().deleteResource(date, section, resourceId);
  lesson = findLessonForSection(state.lessons, date, section)!;
  check("resource deleted", lesson.resources.length === 0);
}

console.log("\n5. Announcements CRUD");
{
  const date = MONDAY;
  const section = "section-algebra-1-p1";
  actions().addAnnouncement(date, section, "First announcement");
  let lesson = findLessonForSection(state.lessons, date, section)!;
  check("announcement added", lesson.announcements.length === 1);

  const announcementId = lesson.announcements[0].id;
  actions().updateAnnouncement(date, section, announcementId, "Updated announcement");
  lesson = findLessonForSection(state.lessons, date, section)!;
  check("announcement update persists", lesson.announcements[0].text === "Updated announcement");

  actions().deleteAnnouncement(date, section, announcementId);
  lesson = findLessonForSection(state.lessons, date, section)!;
  check("announcement deleted", lesson.announcements.length === 0);
}

console.log("\n6. Current section/date lesson lookup (mirrors Present Mode)");
{
  const now = atLocalTime(MONDAY, "08:10"); // inside Period 1, 07:55-08:45
  const presentation = getPresentationState(schedule, now);
  check("Period 1 is student-facing", presentation.mode === "student-facing");
  if (presentation.mode === "student-facing" && presentation.block.classSectionId) {
    const dateKey = getLocalDateKey(now, schedule.timeZone);
    actions().updateLearningTarget(dateKey, presentation.block.classSectionId, "Lookup test target");
    const found = findLessonForSection(state.lessons, dateKey, presentation.block.classSectionId);
    check("lesson found via resolved block's classSectionId + local date", found?.learningTarget === "Lookup test target");
  } else {
    check("Period 1 resolves to a class section", false);
  }
}

console.log("\n7. No-lesson behavior");
{
  const found = findLessonForSection(state.lessons, "2099-01-01", "section-algebra-1-p1");
  check("lookup returns null (not a fake lesson object) when nothing prepared", found === null);
}

console.log("\n8. Enrichment lesson lookup (normal day, not overridden)");
{
  const now = atLocalTime(MONDAY, "09:55"); // inside Enrichment, 09:48-10:08
  const presentation = getPresentationState(schedule, now);
  check("Enrichment block is student-facing", presentation.mode === "student-facing");
  if (presentation.mode === "student-facing" && presentation.block.classSectionId) {
    check("block kind is enrichment (no override today)", presentation.block.kind === "enrichment");
    const dateKey = getLocalDateKey(now, schedule.timeZone);
    actions().updateLearningTarget(dateKey, presentation.block.classSectionId, "Enrichment lookup test");
    const found = findLessonForSection(state.lessons, dateKey, presentation.block.classSectionId);
    check("Enrichment lesson found via the same lookup path", found?.learningTarget === "Enrichment lookup test");
  } else {
    check("Enrichment resolves to a class section", false);
  }
}

console.log("\n9. Thursday SAT Prep lookup through the schedule override");
{
  const now = atLocalTime(THURSDAY, "09:55"); // same block, Thursday override applied
  const presentation = getPresentationState(schedule, now);
  check("overridden block is student-facing", presentation.mode === "student-facing");
  if (presentation.mode === "student-facing" && presentation.block.classSectionId) {
    check(
      "schedule override alone resolved classSectionId to the SAT Prep section",
      presentation.block.classSectionId === "section-sat-prep-thursday",
    );
    const dateKey = getLocalDateKey(now, schedule.timeZone);
    actions().updateLearningTarget(dateKey, presentation.block.classSectionId, "SAT Prep lookup test");
    const found = findLessonForSection(state.lessons, dateKey, presentation.block.classSectionId);
    check(
      "SAT Prep lesson found with no day-specific SAT logic in the lookup itself",
      found?.learningTarget === "SAT Prep lookup test",
    );
  } else {
    check("Thursday override resolves to a class section", false);
  }
}

// --- Copy Lesson ------------------------------------------------------

const COPY_DATE = "2026-09-01";
const COPY_SECTION = "section-geometry-p2"; // course-geometry
const COPY_DEST_SECTION = "section-geometry-p6"; // also course-geometry

actions().updateLearningTarget(COPY_DATE, COPY_SECTION, "Copy source target");
actions().addAgendaItem(COPY_DATE, COPY_SECTION, "Copy agenda item");
actions().addResource(COPY_DATE, COPY_SECTION, { title: "Copy resource", url: "https://example.com/r", type: "link" });
actions().addAnnouncement(COPY_DATE, COPY_SECTION, "Copy announcement");
const sourceLesson = findLessonForSection(state.lessons, COPY_DATE, COPY_SECTION)!;

console.log("\n10. Copy -> Tomorrow");
let tomorrowLesson: ReturnType<typeof findLessonForSection> = null;
{
  const result = actions().copyLessonToTomorrow(sourceLesson.id);
  check("copy to tomorrow reports success", result === "copied");
  const tomorrowDate = addDaysToDateKey(COPY_DATE, 1);
  tomorrowLesson = findLessonForSection(state.lessons, tomorrowDate, COPY_SECTION);
  check("a lesson now exists tomorrow, same section", tomorrowLesson !== null);
  check(
    "copied content matches the source",
    tomorrowLesson?.learningTarget === "Copy source target" &&
      tomorrowLesson?.agendaItems.length === 1 &&
      tomorrowLesson?.resources.length === 1 &&
      tomorrowLesson?.announcements.length === 1,
  );
  check("the copy is an independent lesson (different id)", tomorrowLesson?.id !== sourceLesson.id);
}

console.log("\n11. Copy -> Another Period");
let periodLesson: ReturnType<typeof findLessonForSection> = null;
{
  const destinations = getCopyDestinationSections(state.classSections, COPY_SECTION);
  check("destination section (same course) is offered", destinations.some((s) => s.id === COPY_DEST_SECTION));

  const result = actions().copyLessonToSection(sourceLesson.id, COPY_DEST_SECTION, COPY_DATE);
  check("copy to another period reports success", result === "copied");
  periodLesson = findLessonForSection(state.lessons, COPY_DATE, COPY_DEST_SECTION);
  check("copied content matches the source", periodLesson?.learningTarget === "Copy source target");
}

console.log("\n12. Cross-course section excluded from copy-period options");
{
  const destinations = getCopyDestinationSections(state.classSections, COPY_SECTION);
  check(
    "an Algebra section is not offered as a destination for a Geometry lesson",
    !destinations.some((s) => s.id === "section-algebra-1-p1"),
  );
}

console.log("\n13. Nested IDs regenerated during copy (no shared references)");
{
  const sourceAgendaIds = new Set(sourceLesson.agendaItems.map((i) => i.id));
  const sourceResourceIds = new Set(sourceLesson.resources.map((r) => r.id));
  const sourceAnnouncementIds = new Set(sourceLesson.announcements.map((a) => a.id));

  check(
    "tomorrow copy's agenda ids are new",
    !!tomorrowLesson && tomorrowLesson.agendaItems.every((i) => !sourceAgendaIds.has(i.id)),
  );
  check(
    "tomorrow copy's resource ids are new",
    !!tomorrowLesson && tomorrowLesson.resources.every((r) => !sourceResourceIds.has(r.id)),
  );
  check(
    "tomorrow copy's announcement ids are new",
    !!tomorrowLesson && tomorrowLesson.announcements.every((a) => !sourceAnnouncementIds.has(a.id)),
  );
  check(
    "the two independent copies don't share agenda ids with each other either",
    !!tomorrowLesson &&
      !!periodLesson &&
      tomorrowLesson.agendaItems.every(
        (ti) => !periodLesson!.agendaItems.some((pi) => pi.id === ti.id),
      ),
  );
}

console.log("\n14. Destination lesson cannot be silently overwritten");
{
  // Mutate the source after the period-copy above, so an overwrite would be
  // detectable: the destination should NOT pick this up without consent.
  actions().updateLearningTarget(COPY_DATE, COPY_SECTION, "Changed source target");

  const conflictResult = actions().copyLessonToSection(sourceLesson.id, COPY_DEST_SECTION, COPY_DATE);
  check("copy without overwrite reports a conflict", conflictResult === "conflict");

  const stillOriginal = findLessonForSection(state.lessons, COPY_DATE, COPY_DEST_SECTION);
  check(
    "destination content is untouched after the conflicting attempt",
    stillOriginal?.learningTarget === "Copy source target",
  );

  const overwriteResult = actions().copyLessonToSection(sourceLesson.id, COPY_DEST_SECTION, COPY_DATE, {
    overwrite: true,
  });
  check("explicit overwrite reports success", overwriteResult === "copied");
  const overwritten = findLessonForSection(state.lessons, COPY_DATE, COPY_DEST_SECTION);
  check(
    "destination now reflects the source after explicit confirmation",
    overwritten?.learningTarget === "Changed source target",
  );
  check("overwrite replaces in place (same destination lesson id)", overwritten?.id === periodLesson?.id);
}

console.log("\n15. Agenda completion persists");
{
  const lesson = findLessonForSection(state.lessons, COPY_DATE, COPY_SECTION)!;
  const itemId = lesson.agendaItems[0].id;
  check("agenda item starts incomplete", lesson.agendaItems[0].isCompleted === false);

  actions().toggleAgendaItemCompleted(COPY_DATE, COPY_SECTION, itemId);
  const afterFirstToggle = findLessonForSection(state.lessons, COPY_DATE, COPY_SECTION)!;
  check(
    "completion flips to true and persists",
    afterFirstToggle.agendaItems.find((i) => i.id === itemId)?.isCompleted === true,
  );

  actions().toggleAgendaItemCompleted(COPY_DATE, COPY_SECTION, itemId);
  const afterSecondToggle = findLessonForSection(state.lessons, COPY_DATE, COPY_SECTION)!;
  check(
    "toggling again flips back to false",
    afterSecondToggle.agendaItems.find((i) => i.id === itemId)?.isCompleted === false,
  );
}

console.log("\n16. School-local date handling");
{
  // Nearly 22:00 the evening before in America/Detroit (EDT, UTC-4) - a
  // naive UTC-based date would land on the wrong day.
  const lateEveningUtc = new Date("2026-08-18T02:00:00Z");
  check(
    "getLocalDateKey returns the school-local date, not the UTC date",
    getLocalDateKey(lateEveningUtc, "America/Detroit") === "2026-08-17",
  );
  check(
    "sanity check: naive UTC slicing would have gotten this wrong",
    lateEveningUtc.toISOString().slice(0, 10) === "2026-08-18",
  );
  check("addDaysToDateKey adds one calendar day", addDaysToDateKey("2026-08-17", 1) === "2026-08-18");
  check("addDaysToDateKey rolls over a month boundary", addDaysToDateKey("2026-08-31", 1) === "2026-09-01");
}

console.log("\n17. Existing exact-5:00 countdown unchanged");
{
  check("shouldShowCountdown(300) is true (exactly 5:00 remaining)", shouldShowCountdown(300) === true);
  check("shouldShowCountdown(301) is false (5:01 remaining)", shouldShowCountdown(301) === false);

  // Integration check through the same engine Present Mode calls: Period 1
  // ends at 08:45, so 08:40:00 is exactly 5:00 remaining.
  const atBoundary = getPresentationState(schedule, atLocalTime(MONDAY, "08:40"));
  check(
    "showCountdown is true at exactly 5:00 remaining in a real block",
    atBoundary.mode === "student-facing" && atBoundary.showCountdown === true,
  );
  const justBefore = getPresentationState(schedule, atLocalTime(MONDAY, "08:39"));
  // 08:39:00 -> 6:00 remaining, still outside the countdown window.
  check(
    "showCountdown is false with more than 5:00 remaining",
    justBefore.mode === "student-facing" && justBefore.showCountdown === false,
  );
}

console.log(
  "\n(18. existing schedule verification: run `npm run verify:schedule` alongside this script - " +
    "see `npm run verify` for both together.)",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
