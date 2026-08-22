import type { AppData } from "./types";
import type { Course, ClassSection } from "@/types/course";
import type { AgendaItem, DailyLesson } from "@/types/lesson";
import type { ClassPresentationSettings, ClassroomExperienceSettings } from "@/types/classPresentation";
import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import type { LibraryResource } from "@/types/resource";
import type { BellSchedule } from "@/types/schedule";
import { createOhhsRegularSchedule, OHHS_REGULAR_ID } from "@/lib/schedule/presets/ohhsRegular";
import { createDemoEarlyReleaseSchedule, createDemoTestingDaySchedule } from "@/lib/schedule/presets/demoSpecialSchedules";
import { parseMasterCalendarJson, commitMasterCalendarImport } from "@/lib/calendar/masterCalendarImport";
import { OHHS_MASTER_CALENDAR_2026_JSON } from "@/lib/data/ohhsMasterCalendar2026";
import { DEMO_REGULAR_DATE, DEMO_TESTING_DAY_DATE } from "@/lib/data/demoScenarioDates";

/**
 * ---------------------------------------------------------------------
 * DEMO MODE seed data (Part 13-16) - entirely separate from Phase 1's
 * createDemoAppData() (lib/data/demoData.ts), which seeds a brand-new
 * REAL installation. This seeds the isolated, disposable sandbox served
 * by DemoDataRepository - a principal or teacher can click around freely
 * without ever touching real AppData.
 *
 * Uses the REAL OHHS Regular Day bell schedule (official times, not
 * fictional), the REAL OHHS 2026-27 Master Calendar exceptions (imported
 * through the exact same parse/commit pipeline the real UI uses - this is
 * what lets Demo Mode prove the calendar -> schedule -> Present Mode
 * chain actually works, not just display a text card), plus two clearly-
 * labeled sample special schedules (Early Release, Testing Day) since the
 * real OHHS early-release/half-day period sequences aren't known yet.
 * ---------------------------------------------------------------------
 */

let demoIdSequence = 0;
function demoId(prefix: string): string {
  demoIdSequence += 1;
  return `demo-mode-${prefix}-${demoIdSequence}`;
}

function agendaItem(title: string, sortOrder: number, details?: string): AgendaItem {
  return { id: demoId("agenda"), title, details, isCompleted: false, sortOrder };
}

export const DEMO_COURSE_ALGEBRA = "demo-course-algebra-1";
export const DEMO_COURSE_GEOMETRY = "demo-course-geometry";
export const DEMO_COURSE_ENRICHMENT = "demo-course-enrichment";
export const DEMO_COURSE_PREP = "demo-course-prep";

const DEMO_COURSES: Course[] = [
  { id: DEMO_COURSE_ALGEBRA, name: "Algebra 1", colorHex: "#8B5E34" },
  { id: DEMO_COURSE_GEOMETRY, name: "Geometry", colorHex: "#C9A227" },
  { id: DEMO_COURSE_ENRICHMENT, name: "Enrichment", colorHex: "#6B7C59" },
  { id: DEMO_COURSE_PREP, name: "Prep", colorHex: "#7A7267" },
];

export const DEMO_SECTION_ALGEBRA_1ST = "demo-section-algebra-1st";
export const DEMO_SECTION_GEOMETRY_2ND = "demo-section-geometry-2nd";
export const DEMO_SECTION_ENRICHMENT = "demo-section-enrichment";
export const DEMO_SECTION_ALGEBRA_4TH = "demo-section-algebra-4th";
export const DEMO_SECTION_GEOMETRY_5TH = "demo-section-geometry-5th";
export const DEMO_SECTION_PREP = "demo-section-prep";
export const DEMO_SECTION_GEOMETRY_7TH = "demo-section-geometry-7th";

const DEMO_CLASS_SECTIONS: ClassSection[] = [
  { id: DEMO_SECTION_ALGEBRA_1ST, courseId: DEMO_COURSE_ALGEBRA, name: "Algebra 1 — 1st Hour" },
  { id: DEMO_SECTION_GEOMETRY_2ND, courseId: DEMO_COURSE_GEOMETRY, name: "Geometry — 2nd Hour" },
  { id: DEMO_SECTION_ENRICHMENT, courseId: DEMO_COURSE_ENRICHMENT, name: "Enrichment" },
  { id: DEMO_SECTION_ALGEBRA_4TH, courseId: DEMO_COURSE_ALGEBRA, name: "Algebra 1 — 4th Hour" },
  { id: DEMO_SECTION_GEOMETRY_5TH, courseId: DEMO_COURSE_GEOMETRY, name: "Geometry — 5th Hour" },
  { id: DEMO_SECTION_PREP, courseId: DEMO_COURSE_PREP, name: "Prep" },
  { id: DEMO_SECTION_GEOMETRY_7TH, courseId: DEMO_COURSE_GEOMETRY, name: "Geometry — 7th Hour" },
];

/** The real OHHS_REGULAR preset, with demo class sections assigned to each period so every official time block resolves to something real. */
function buildDemoOhhsRegularSchedule(): BellSchedule {
  const base = createOhhsRegularSchedule();
  const assignments: Record<string, string> = {
    [`${OHHS_REGULAR_ID}-period-1`]: DEMO_SECTION_ALGEBRA_1ST,
    [`${OHHS_REGULAR_ID}-period-2`]: DEMO_SECTION_GEOMETRY_2ND,
    [`${OHHS_REGULAR_ID}-period-3`]: DEMO_SECTION_ENRICHMENT,
    [`${OHHS_REGULAR_ID}-period-4`]: DEMO_SECTION_ALGEBRA_4TH,
    [`${OHHS_REGULAR_ID}-period-5`]: DEMO_SECTION_GEOMETRY_5TH,
    [`${OHHS_REGULAR_ID}-period-6`]: DEMO_SECTION_PREP,
    [`${OHHS_REGULAR_ID}-period-7`]: DEMO_SECTION_GEOMETRY_7TH,
  };
  return {
    ...base,
    isDefault: true,
    blocks: base.blocks.map((block) =>
      assignments[block.id] ? { ...block, classSectionId: assignments[block.id] } : block,
    ),
  };
}

function algebraLesson(date: string, classSectionId: string): DailyLesson {
  const now = new Date().toISOString();
  return {
    id: demoId("lesson"),
    date,
    classSectionId,
    learningTarget: "I can solve multi-step equations and justify each inverse operation.",
    agendaItems: [
      agendaItem("Warm-Up — Two-Step Equation Review", 0),
      agendaItem("Mini Lesson", 1),
      agendaItem("Guided Practice", 2),
      agendaItem("Independent Practice", 3),
      agendaItem("Exit Ticket", 4),
    ],
    resources: [
      { id: demoId("resource"), title: "Guided Notes", url: "https://example.com/falcon-deck-demo/algebra-guided-notes", type: "document" },
      { id: demoId("resource"), title: "Desmos Practice", url: "https://www.desmos.com/calculator", type: "desmos" },
      { id: demoId("resource"), title: "Practice Set", url: "https://example.com/falcon-deck-demo/algebra-practice-set", type: "document" },
    ],
    announcements: [
      { id: demoId("announcement"), text: "Quiz Friday" },
      { id: demoId("announcement"), text: "Corrections due tomorrow" },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function geometryLesson(date: string, classSectionId: string): DailyLesson {
  const now = new Date().toISOString();
  return {
    id: demoId("lesson"),
    date,
    classSectionId,
    learningTarget: "I can use angle relationships to determine unknown angle measures.",
    agendaItems: [
      agendaItem("Warm-Up", 0),
      agendaItem("Angle Relationships Review", 1),
      agendaItem("Teacher Modeling", 2),
      agendaItem("Partner Practice", 3),
      agendaItem("Exit Ticket", 4),
    ],
    resources: [
      { id: demoId("resource"), title: "Angle Reference Sheet", url: "https://example.com/falcon-deck-demo/angle-reference-sheet", type: "document" },
      { id: demoId("resource"), title: "Practice Problems", url: "https://example.com/falcon-deck-demo/geometry-practice-problems", type: "document" },
      { id: demoId("resource"), title: "Interactive Activity", url: "https://www.desmos.com/geometry", type: "link" },
    ],
    announcements: [{ id: demoId("announcement"), text: "Homework due tomorrow" }],
    createdAt: now,
    updatedAt: now,
  };
}

function enrichmentLesson(date: string, classSectionId: string): DailyLesson {
  const now = new Date().toISOString();
  return {
    id: demoId("lesson"),
    date,
    classSectionId,
    learningTarget: "I can identify my highest-priority academic task and use my enrichment time productively.",
    agendaItems: [
      agendaItem("Check grades", 0),
      agendaItem("Missing-work review", 1),
      agendaItem("Goal for today", 2),
      agendaItem("Work block", 3),
    ],
    resources: [],
    announcements: [],
    createdAt: now,
    updatedAt: now,
  };
}

function buildDemoLessons(regularDate: string): DailyLesson[] {
  return [
    algebraLesson(regularDate, DEMO_SECTION_ALGEBRA_1ST),
    geometryLesson(regularDate, DEMO_SECTION_GEOMETRY_2ND),
    enrichmentLesson(regularDate, DEMO_SECTION_ENRICHMENT),
    algebraLesson(regularDate, DEMO_SECTION_ALGEBRA_4TH),
    geometryLesson(regularDate, DEMO_SECTION_GEOMETRY_5TH),
    geometryLesson(regularDate, DEMO_SECTION_GEOMETRY_7TH),
  ];
}

const DEMO_ARRIVAL_ROUTINES: ClassPresentationSettings[] = [
  { classSectionId: DEMO_SECTION_ALGEBRA_1ST, arrivalInstructions: ["Chromebook open", "Notebook out", "Begin the warm-up"] },
  { classSectionId: DEMO_SECTION_ALGEBRA_4TH, arrivalInstructions: ["Chromebook open", "Notebook out", "Begin the warm-up"] },
  { classSectionId: DEMO_SECTION_GEOMETRY_2ND, arrivalInstructions: ["Calculator ready", "Notebook open", "Start the posted problem"] },
  { classSectionId: DEMO_SECTION_GEOMETRY_5TH, arrivalInstructions: ["Calculator ready", "Notebook open", "Start the posted problem"] },
  { classSectionId: DEMO_SECTION_GEOMETRY_7TH, arrivalInstructions: ["Calculator ready", "Notebook open", "Start the posted problem"] },
  { classSectionId: DEMO_SECTION_ENRICHMENT, arrivalInstructions: ["Check grades", "Open missing-work list", "Choose first priority"] },
];

function libraryResource(
  title: string,
  url: string,
  type: LibraryResource["type"],
  courseIds: string[],
  tags: string[],
  isFavorite: boolean,
): LibraryResource {
  const now = "2026-08-01T00:00:00.000Z";
  return {
    id: demoId("library"),
    title,
    url,
    type,
    courseIds,
    tags,
    isFavorite,
    source: { kind: "manual" },
    createdAt: now,
    updatedAt: now,
  };
}

const DEMO_LIBRARY_RESOURCES: LibraryResource[] = [
  libraryResource("Desmos Graphing Calculator", "https://www.desmos.com/calculator", "desmos", [DEMO_COURSE_ALGEBRA, DEMO_COURSE_GEOMETRY], ["warm-up", "practice"], true),
  libraryResource("Algebra Guided Notes Template", "https://example.com/falcon-deck-demo/algebra-guided-notes-template", "document", [DEMO_COURSE_ALGEBRA], ["notes"], true),
  libraryResource("Angle Reference Sheet", "https://example.com/falcon-deck-demo/angle-reference-sheet", "document", [DEMO_COURSE_GEOMETRY], ["notes", "review"], false),
  libraryResource("Two-Step Equations Practice", "https://example.com/falcon-deck-demo/two-step-equations-practice", "document", [DEMO_COURSE_ALGEBRA], ["practice", "review"], false),
  libraryResource("Exit Ticket Template", "https://example.com/falcon-deck-demo/exit-ticket-template", "document", [], ["exit-ticket"], false),
  libraryResource("Unit Review Slides", "https://example.com/falcon-deck-demo/unit-review-slides", "slides", [DEMO_COURSE_GEOMETRY], ["review"], false),
];

/**
 * Builds the demo Master Calendar by importing the REAL OHHS 2026-27
 * calendar through the exact same parse/commit pipeline the real UI uses
 * - then remaps early-release dates from the still-unconfigured
 * OHHS_EARLY_RELEASE_1124 to the clearly-labeled DEMO_EARLY_RELEASE
 * profile (so the Early Release scenario actually resolves a schedule
 * instead of showing "Needs Configuration"), and adds one synthetic
 * Testing Day exception the real calendar doesn't have. The Last Student
 * Day / Half Day exception is deliberately left pointing at the real,
 * still-unconfigured profile - Demo Mode shows that state too, on
 * purpose (Part 6's "never fabricate bell times" rule applies here too).
 */
function buildDemoCalendarAndSchedules(): { calendar: AppData["schoolCalendar"]; extraSchedules: BellSchedule[] } {
  const parsed = parseMasterCalendarJson(OHHS_MASTER_CALENDAR_2026_JSON);
  if (!parsed.ok) throw new Error("Demo Mode's bundled OHHS master calendar failed to parse - this is a bug.");

  const remappedExceptions = parsed.exceptions.map((exception) =>
    exception.scheduleProfileKey === "OHHS_EARLY_RELEASE_1124"
      ? { ...exception, scheduleProfileKey: "DEMO_EARLY_RELEASE" }
      : exception,
  );
  remappedExceptions.push({
    startDate: DEMO_TESTING_DAY_DATE,
    endDate: DEMO_TESTING_DAY_DATE,
    type: "special-bell",
    title: "Testing / Assembly Day",
    scheduleProfileKey: "DEMO_TESTING_DAY",
  });

  const demoEarlyRelease = createDemoEarlyReleaseSchedule();
  const demoTestingDay = createDemoTestingDaySchedule();
  const ohhsRegular = buildDemoOhhsRegularSchedule();

  const result = commitMasterCalendarImport({
    meta: parsed.meta,
    exceptions: remappedExceptions,
    existingCalendar: null,
    bellSchedules: [ohhsRegular, demoEarlyRelease, demoTestingDay],
    conflictResolution: "skip",
    generateExceptionId: () => demoId("calendar-exception"),
    generateCalendarId: () => demoId("calendar"),
  });

  return { calendar: result.calendar, extraSchedules: result.newBellSchedules };
}

const DEMO_CLASSROOM_EXPERIENCE_SETTINGS: ClassroomExperienceSettings = {
  ...DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
  finalFiveMessage: "Wrap up and pack up.",
  endOfDayMessage: "Thanks for a great day, Falcons!",
};

export function createDemoModeAppData(): AppData {
  const ohhsRegular = buildDemoOhhsRegularSchedule();
  const demoEarlyRelease = createDemoEarlyReleaseSchedule();
  const demoTestingDay = createDemoTestingDaySchedule();
  const { calendar, extraSchedules } = buildDemoCalendarAndSchedules();

  const schedules = [ohhsRegular, demoEarlyRelease, demoTestingDay, ...extraSchedules];

  return structuredClone({
    courses: DEMO_COURSES,
    classSections: DEMO_CLASS_SECTIONS,
    schedules,
    lessons: buildDemoLessons(DEMO_REGULAR_DATE),
    classPresentationSettings: DEMO_ARRIVAL_ROUTINES,
    classroomExperienceSettings: DEMO_CLASSROOM_EXPERIENCE_SETTINGS,
    libraryResources: DEMO_LIBRARY_RESOURCES,
    teacherSchedulePreferences: { lunchWave: "B" },
    schoolCalendar: calendar,
  });
}
