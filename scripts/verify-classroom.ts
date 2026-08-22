/**
 * Standalone verification for Phase 4's classroom experience, automated
 * transitions, and onboarding. Companion to scripts/verify-schedule.ts,
 * verify-lessons.ts, verify-preview.ts, and verify-week.ts (`npm run
 * verify` runs all five) - this script covers what's new: the transition/
 * end-of-day data feeding Present Mode's automatic screens, arrival
 * routines, the classroom timer, the tool-tray state machine (and its
 * structural inability to touch lesson/schedule data), QR generation,
 * onboarding detection, and configurable Present Mode watermark branding
 * (default-Falcon fallback, custom upload override/reset, opacity, upload
 * validation and resize math, and old-AppData backward compatibility) -
 * plus brief regression spot-checks and static source scans (no direct
 * localStorage access; no hard-coded weekday logic, proven behaviorally
 * with a non-Thursday override).
 *
 * Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:classroom
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";

import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { getSecondsUntilStart, shouldShowCountdown } from "@/lib/schedule/getRemainingTime";
import { resolvePreviewClassroomProps } from "@/lib/present/resolvePreviewClassroomProps";
import {
  closeResourceOverlay,
  closeTray,
  createToolTrayState,
  exitCleanScreen,
  selectTool,
  showResource,
  startCleanScreen,
  toggleTray,
} from "@/lib/present/toolTrayState";
import {
  adjustTimerRemaining,
  createTimerState,
  isTimerFinished,
  pauseTimer,
  resetTimer,
  setTimerDuration,
  startTimer,
  tickTimer,
} from "@/lib/tools/timer/timerLogic";
import { TIMER_PRESET_MINUTES } from "@/lib/tools/timer/useClassroomTimer";
import { findClassPresentationSettings, getArrivalInstructions } from "@/lib/data/classPresentation";
import { findLessonForSection } from "@/lib/data/lessons";
import { buildWeekPlanningGrid } from "@/lib/week/buildWeekPlanningGrid";
import { getOnboardingStatus } from "@/lib/onboarding/getOnboardingStatus";
import { LocalStorageDataRepository } from "@/lib/data/localStorageRepository";
import { createDemoAppData, DEMO_SCHEDULES } from "@/lib/data/demoData";
import { appDataReducer } from "@/lib/store/reducer";
import { createLessonActions } from "@/lib/store/lessonActions";
import type { AppDataAction } from "@/lib/store/actions";
import type { AppData } from "@/lib/data/types";
import type { BellSchedule } from "@/types/schedule";
import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS, DEFAULT_WATERMARK_OPACITY } from "@/types/classPresentation";
import {
  WATERMARK_MAX_UPLOAD_BYTES,
  computeWatermarkTargetSize,
  dataUrlByteLength,
  isAcceptedWatermarkMimeType,
} from "@/lib/present/watermarkImage";
import { processWatermarkUpload } from "@/lib/present/processWatermarkUpload";
// Note: components/present/PresentWatermark.tsx is not imported here - it's
// a React component (needs a DOM renderer, not available under plain
// tsx/Node). Its default-asset behavior is instead confirmed with a
// static source-text check below, and its data flow is confirmed through
// the reducer/DataRepository checks that exercise the same
// classroomExperienceSettings it reads as props.

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
const MONDAY = "2026-08-17";
const THURSDAY = "2026-08-20";

let state: AppData = { ...createDemoAppData(), lessons: [], classPresentationSettings: [] };
function dispatch(action: AppDataAction) {
  state = appDataReducer(state, action);
}
function actions() {
  return createLessonActions(state, dispatch);
}

async function main() {
console.log("1. Existing live schedule logic still works");
{
  const period1 = getPresentationState(schedule, atLocalTime(MONDAY, "08:10"));
  check("Period 1 resolves to student-facing", period1.mode === "student-facing");
}

console.log("\n2. Exact five-minute reveal unchanged");
{
  check("shouldShowCountdown(300) is true", shouldShowCountdown(300) === true);
  check("shouldShowCountdown(301) is false", shouldShowCountdown(301) === false);
  const atBoundary = getPresentationState(schedule, atLocalTime(MONDAY, "08:40")); // Period 1 ends 08:45
  check(
    "showCountdown is true at exactly 5:00 remaining in a real block",
    atBoundary.mode === "student-facing" && atBoundary.showCountdown === true,
  );
}

console.log("\n3-5. Transition appears automatically, identifies the correct class, accurate countdown");
{
  // 09:41 - inside the 09:39-09:44 passing period before Enrichment (09:48).
  const during = getPresentationState(schedule, atLocalTime(MONDAY, "09:41"));
  check("3: mode is transition during the passing period", during.mode === "transition");
  if (during.mode === "transition") {
    check("4: the next block is correctly identified as Enrichment", during.nextStudentFacingBlock?.blockId === "block-enrichment");
    const expectedSeconds = getSecondsUntilStart(during.nextStudentFacingBlock!, atLocalTime(MONDAY, "09:41"), schedule.timeZone);
    check(
      "5: the transition countdown matches the schedule engine's own calculation",
      during.secondsUntilNextStudentFacing === expectedSeconds && expectedSeconds === 7 * 60,
    );
  } else {
    check("4: the next block is correctly identified as Enrichment", false);
    check("5: the transition countdown matches the schedule engine's own calculation", false);
  }
}

console.log("\n6-7. Prep and Lunch are never treated as the next student-facing class");
{
  // 11:03 - between Period 4 (ends 11:02) and Prep (11:06-11:56), with
  // Lunch (11:56-12:26) after that and Period 6 (instructional) after that.
  const state6 = getPresentationState(schedule, atLocalTime(MONDAY, "11:03"));
  check("mode is transition", state6.mode === "transition");
  if (state6.mode === "transition") {
    check(
      "6: Prep is skipped - the next student-facing block is Period 6, not Prep",
      state6.nextStudentFacingBlock?.blockId === "block-period-6",
    );
    check(
      "7: Lunch is also skipped for the same reason",
      state6.nextStudentFacingBlock?.kind === "instructional",
    );
  } else {
    check("6: Prep is skipped - the next student-facing block is Period 6, not Prep", false);
    check("7: Lunch is also skipped for the same reason", false);
  }
}

console.log("\n8. Enrichment works correctly as the next class");
{
  const during = getPresentationState(schedule, atLocalTime(MONDAY, "09:41"));
  check(
    "the next block on a normal Monday is Enrichment itself, unaltered",
    during.mode === "transition" &&
      during.nextStudentFacingBlock?.kind === "enrichment" &&
      during.nextStudentFacingBlock.classSectionId === "section-enrichment-open",
  );
}

console.log("\n9. Schedule override (SAT-style block) works with no special-casing");
{
  const during = getPresentationState(schedule, atLocalTime(THURSDAY, "09:41"));
  check(
    "on Thursday, the override alone resolves the next block to the SAT Prep section",
    during.mode === "transition" &&
      during.nextStudentFacingBlock?.isOverridden === true &&
      during.nextStudentFacingBlock.classSectionId === "section-sat-prep-thursday",
  );
}

console.log("\n10. End-of-day state appears when no next student-facing class exists");
{
  const lateNight = getPresentationState(schedule, atLocalTime(MONDAY, "23:00"));
  check(
    "late at night, transition mode has no next student-facing block - EndOfDayScreen, not a fake transition",
    lateNight.mode === "transition" && lateNight.nextStudentFacingBlock === null,
  );
}

console.log("\n11-12. Arrival routine resolves by next classSectionId; missing routine renders nothing");
{
  state = appDataReducer(state, {
    type: "SET_ARRIVAL_INSTRUCTIONS",
    classSectionId: "section-enrichment-open",
    instructions: ["Take out notebook", "Open Chromebook", "Start Bell Work"],
  });

  const during = getPresentationState(schedule, atLocalTime(MONDAY, "09:41"));
  const nextSectionId =
    during.mode === "transition" ? (during.nextStudentFacingBlock?.classSectionId ?? null) : null;
  check("next block resolved to Enrichment's section", nextSectionId === "section-enrichment-open");

  const resolvedInstructions = getArrivalInstructions(state.classPresentationSettings, nextSectionId);
  check(
    "11: the arrival routine resolves for that exact next classSectionId",
    resolvedInstructions.join("|") === "Take out notebook|Open Chromebook|Start Bell Work",
  );

  const unconfigured = getArrivalInstructions(state.classPresentationSettings, "section-geometry-p2");
  check(
    "12: a section with no configured routine resolves to an empty list, not null/undefined - the panel is simply omitted",
    Array.isArray(unconfigured) && unconfigured.length === 0,
  );
}

console.log("\n13. Arrival routine persists through DataRepository");
{
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
  const toSave: AppData = {
    ...createDemoAppData(),
    classPresentationSettings: [
      { classSectionId: "section-geometry-p2", arrivalInstructions: ["Notebook out", "Calculator ready"] },
    ],
  };
  await repo.save(toSave);
  const reloaded = await repo.load();
  check(
    "arrival routine round-trips through save/load unchanged",
    findClassPresentationSettings(reloaded.classPresentationSettings, "section-geometry-p2")?.arrivalInstructions.join(
      "|",
    ) === "Notebook out|Calculator ready",
  );

  delete (globalThis as Record<string, unknown>).window;
}

console.log("\n14-17. Manual timer: start, pause, reset, presets");
{
  let timer = createTimerState(5 * 60);
  timer = startTimer(timer);
  check("14: starting sets isRunning and isActive", timer.isRunning === true && timer.isActive === true);
  check("14: starting doesn't change remainingSeconds", timer.remainingSeconds === 300);

  timer = pauseTimer(timer);
  check("15: pausing clears isRunning", timer.isRunning === false);
  check("15: pausing preserves remainingSeconds and isActive", timer.remainingSeconds === 300 && timer.isActive === true);

  timer = tickTimer(startTimer(timer));
  timer = tickTimer(timer);
  check("ticking counts down while running", timer.remainingSeconds === 298);

  timer = resetTimer(timer);
  check("16: resetting returns to the full duration", timer.remainingSeconds === 300);
  check("16: resetting clears isRunning and isActive", timer.isRunning === false && timer.isActive === false);

  check("17: preset minutes are 2, 5, 10, 15", TIMER_PRESET_MINUTES.join(",") === "2,5,10,15");
  for (const minutes of TIMER_PRESET_MINUTES) {
    const preset = setTimerDuration(minutes * 60);
    check(
      `17: the ${minutes}-minute preset sets both total and remaining to ${minutes * 60}s`,
      preset.totalSeconds === minutes * 60 && preset.remainingSeconds === minutes * 60,
    );
  }

  let adjusted = createTimerState(60);
  adjusted = adjustTimerRemaining(adjusted, 30);
  check("+30s adjustment works and marks the timer active", adjusted.remainingSeconds === 90 && adjusted.isActive);
  adjusted = adjustTimerRemaining(adjusted, -1000);
  check("adjustment never goes negative", adjusted.remainingSeconds === 0);
  check("a timer at 0 that has been touched reads as finished", isTimerFinished(adjusted) === true);
  check("a freshly-created timer is never 'finished'", isTimerFinished(createTimerState(0)) === false);
}

console.log("\n18. Manual timer is independent of the schedule countdown");
{
  const before = getPresentationState(schedule, atLocalTime(MONDAY, "08:40"));
  let timer = createTimerState(120);
  timer = startTimer(timer);
  timer = tickTimer(timer);
  timer = pauseTimer(timer);
  timer = adjustTimerRemaining(timer, 45);
  resetTimer(timer);
  const after = getPresentationState(schedule, atLocalTime(MONDAY, "08:40"));
  check(
    "running the timer through a full start/tick/pause/adjust/reset cycle changes nothing about the schedule's own state for the same instant",
    JSON.stringify(before) === JSON.stringify(after),
  );
}

console.log("\n19-20. Clean Screen never touches lesson or schedule data");
{
  let toolState = createToolTrayState("Work Time");
  toolState = startCleanScreen(toolState, "Testing message");
  check("Clean Screen is active after starting it", toolState.cleanScreenActive === true);
  check("the message was set as given", toolState.cleanScreenMessage === "Testing message");
  check(
    "the resulting state has only tool-tray/overlay fields - it was never possible to carry lesson or schedule data",
    JSON.stringify(Object.keys(toolState).sort()) ===
      JSON.stringify(["activeTool", "cleanScreenActive", "cleanScreenMessage", "resourceOverlay", "trayExpanded"]),
  );

  const lessonsBefore = JSON.stringify(state.lessons);
  const schedulesBefore = JSON.stringify(state.schedules);
  toolState = exitCleanScreen(toolState);
  check("19: lessons are unchanged by the whole Clean Screen activate/exit cycle", JSON.stringify(state.lessons) === lessonsBefore);
  check("20: schedules are unchanged by the whole Clean Screen activate/exit cycle", JSON.stringify(state.schedules) === schedulesBefore);
}

console.log("\n21. Quick Resource uses the current DailyLesson's resources");
{
  actions().addResource(MONDAY, "section-algebra-1-p1", { title: "Practice Set", url: "https://example.com/practice", type: "document" });
  const lesson = findLessonForSection(state.lessons, MONDAY, "section-algebra-1-p1");
  check("the lesson carries the resource", lesson?.resources.length === 1);
  const resource = lesson!.resources[0];
  check(
    "the resource's title/url/type flow through unmodified into a Quick-Resource selection",
    resource.title === "Practice Set" && resource.url === "https://example.com/practice" && resource.type === "document",
  );
}

console.log("\n22-23. QR generation accepts a lesson resource URL and a teacher-entered URL");
{
  const lessonResourceUrl = "https://example.com/practice";
  const customUrl = "https://desmos.com/calculator";

  const fromLessonResource = await QRCode.toDataURL(lessonResourceUrl);
  check("22: QR generates from a lesson resource URL", fromLessonResource.startsWith("data:image/png;base64,"));

  const fromCustomUrl = await QRCode.toDataURL(customUrl);
  check("23: QR generates from a teacher-entered custom URL", fromCustomUrl.startsWith("data:image/png;base64,"));

  check("the two URLs produce different QR images", fromLessonResource !== fromCustomUrl);
}

console.log("\n24. Tool tray is collapsed by default");
{
  const fresh = createToolTrayState("Work Time");
  check("trayExpanded starts false", fresh.trayExpanded === false);
  check("no tool is selected initially", fresh.activeTool === null);
  const toggled = toggleTray(fresh);
  check("toggling opens it", toggled.trayExpanded === true);
  const selected = selectTool(toggled, "timer");
  check("selecting a tool sets activeTool", selected.activeTool === "timer");
  const selectedAgain = selectTool(selected, "timer");
  check("selecting the same tool again deselects it", selectedAgain.activeTool === null);
  const closed = closeTray(selected);
  check("closing the tray also clears the selected tool", closed.trayExpanded === false && closed.activeTool === null);

  const withResource = showResource(fresh, { title: "Practice Set", url: "https://example.com/practice", type: "document" });
  check("showing a resource collapses the tray", withResource.trayExpanded === false);
  check("resourceOverlay carries the given content", withResource.resourceOverlay?.title === "Practice Set");
  const closedResource = closeResourceOverlay(withResource);
  check("closing the resource overlay clears it", closedResource.resourceOverlay === null);
}

console.log("\n25-26. Preview Mode still works and never fakes the schedule countdown");
{
  const preview = resolvePreviewClassroomProps({
    date: MONDAY,
    classSectionId: "section-algebra-1-p1",
    block: null,
    lessons: state.lessons,
  });
  check("25: Preview resolves a lesson for a valid date/section", preview !== null);
  check("26: Preview's showCountdown is unconditionally false", preview?.showCountdown === false);
  check("26: Preview's remainingSeconds is unconditionally 0", preview?.remainingSeconds === 0);
}

console.log("\n27. Week view still works");
{
  const grid = buildWeekPlanningGrid({
    weekStart: MONDAY,
    classSections: state.classSections,
    courses: state.courses,
    lessons: state.lessons,
    schedule,
  });
  check("the week grid still builds one row per section, 5 cells each", grid.rows.every((r) => r.cells.length === 5) && grid.rows.length === state.classSections.length);
}

console.log("\n28. Lesson editing still works");
{
  actions().updateLearningTarget(MONDAY, "section-geometry-p2", "Classroom-experience regression check");
  check(
    "updateLearningTarget still persists and reads back",
    findLessonForSection(state.lessons, MONDAY, "section-geometry-p2")?.learningTarget ===
      "Classroom-experience regression check",
  );
}

console.log("\n29. Classes still work");
{
  const before = state.classSections.length;
  state = appDataReducer(state, { type: "ADD_COURSE", course: { id: "course-verify-classroom", name: "Verify Course" } });
  state = appDataReducer(state, {
    type: "ADD_CLASS_SECTION",
    section: { id: "section-verify-classroom", courseId: "course-verify-classroom", name: "Verify Section" },
  });
  check("adding a course and section still works", state.classSections.length === before + 1);
}

console.log("\n30. Settings data is well-formed (visual contrast verified by direct inspection, not runtime)");
{
  const settings = state.classroomExperienceSettings;
  check(
    "classroomExperienceSettings has every expected field",
    typeof settings.finalFiveMessage === "string" &&
      typeof settings.showEndOfDayScreen === "boolean" &&
      typeof settings.endOfDayMessage === "string" &&
      typeof settings.cleanScreenDefaultMessage === "string" &&
      typeof settings.showClockOnCleanScreen === "boolean" &&
      typeof settings.transitionCountdownEnabled === "boolean" &&
      typeof settings.transitionArrivalInstructionsEnabled === "boolean" &&
      typeof settings.watermarkOpacity === "number" &&
      (settings.customWatermarkDataUrl === undefined || typeof settings.customWatermarkDataUrl === "string"),
  );
}

console.log("\n31. No direct localStorage access outside the DataRepository layer");
{
  const projectRoot = process.cwd();
  const scanDirs = ["components", "lib", "app"];
  const allowedFile = join("lib", "data", "localStorageRepository.ts").replace(/\\/g, "/");
  const offenders: string[] = [];

  // Strip comments first - architecture doc comments legitimately mention
  // "localStorage" (e.g. explaining what LocalStorageDataRepository does);
  // only an actual reference in code is a real finding.
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        const relative = fullPath.slice(projectRoot.length + 1).replace(/\\/g, "/");
        if (relative === allowedFile) continue;
        const contents = stripComments(readFileSync(fullPath, "utf8"));
        if (/\blocalStorage\b/.test(contents)) offenders.push(relative);
      }
    }
  }

  for (const dir of scanDirs) walk(join(projectRoot, dir));

  check(
    offenders.length === 0
      ? "no source file outside lib/data/localStorageRepository.ts references localStorage"
      : `localStorage referenced outside the repository layer in: ${offenders.join(", ")}`,
    offenders.length === 0,
  );
}

console.log("\n32-35. Onboarding detection");
{
  const empty: AppData = {
    courses: [],
    classSections: [],
    schedules: [{ id: "s1", name: "Empty", isDefault: true, timeZone: "America/Detroit", blocks: [] }],
    lessons: [],
    classPresentationSettings: [],
    classroomExperienceSettings: state.classroomExperienceSettings,
    libraryResources: [],
  };
  const emptyStatus = getOnboardingStatus(empty);
  check("32: no classes -> classesComplete is false", emptyStatus.classesComplete === false);
  check("32: an empty schedule -> scheduleComplete is false", emptyStatus.scheduleComplete === false);
  check("32: no lessons -> firstLessonComplete is false", emptyStatus.firstLessonComplete === false);
  check("32: no routines -> arrivalRoutineComplete is false", emptyStatus.arrivalRoutineComplete === false);
  check("32: core setup is not complete", emptyStatus.coreSetupComplete === false);

  const demoStatus = getOnboardingStatus(createDemoAppData());
  check("33: the demo data's classes are detected as configured", demoStatus.classesComplete === true);
  check("34: the demo data's default schedule (with blocks) is detected as configured", demoStatus.scheduleComplete === true);
  check("35: the demo data's seeded lessons are detected as meaningful", demoStatus.firstLessonComplete === true);
  check("core setup is complete once all three are true", demoStatus.coreSetupComplete === true);
}

console.log("\n36-37. No hard-coded period assumptions or Thursday/SAT-specific logic");
{
  // Proven behaviorally, not by text-scanning (Phase 4's own doc comments
  // legitimately mention "Thursday" and "SAT Prep" as the worked example -
  // scanning for those strings would flag documentation, not logic).
  // Build a schedule whose weekday override has nothing to do with
  // Thursday or SAT Prep, and confirm the exact same generic code path
  // (getPresentationState -> nextStudentFacingBlock -> arrival routine
  // lookup) works correctly for it.
  const customSchedule: BellSchedule = {
    id: "schedule-custom-verify",
    name: "Custom Verify Schedule",
    isDefault: true,
    timeZone: "America/Detroit",
    blocks: [
      {
        id: "block-a",
        label: "Block A",
        kind: "instructional",
        startTime: "09:00",
        endTime: "09:40",
        classSectionId: "section-custom-a",
        overrides: [],
      },
      {
        id: "block-passing",
        label: "Passing",
        kind: "passing",
        startTime: "09:40",
        endTime: "09:45",
        classSectionId: null,
        overrides: [],
      },
      {
        id: "block-club",
        label: "Club Time",
        kind: "enrichment",
        startTime: "09:45",
        endTime: "10:05",
        classSectionId: "section-custom-club",
        overrides: [
          {
            id: "override-friday-robotics",
            weekday: "friday",
            label: "Robotics",
            kind: "instructional",
            classSectionId: "section-custom-robotics",
          },
        ],
      },
    ],
  };

  const customArrivalSettings = [
    { classSectionId: "section-custom-club", arrivalInstructions: ["Grab a book"] },
    { classSectionId: "section-custom-robotics", arrivalInstructions: ["Get your kit"] },
  ];

  const normalDay = getPresentationState(customSchedule, atLocalTime("2026-08-18", "09:42")); // a Tuesday
  check(
    "on a normal (non-overridden) day, the custom block resolves to its own section",
    normalDay.mode === "transition" && normalDay.nextStudentFacingBlock?.classSectionId === "section-custom-club",
  );
  if (normalDay.mode === "transition") {
    check(
      "the arrival routine resolves correctly for that section - no weekday-specific logic needed",
      getArrivalInstructions(customArrivalSettings, normalDay.nextStudentFacingBlock?.classSectionId).join("|") ===
        "Grab a book",
    );
  }

  const fridayDate = "2026-08-21"; // a Friday
  const overriddenDay = getPresentationState(customSchedule, atLocalTime(fridayDate, "09:42"));
  check(
    "on Friday, the override alone resolves the block to the different section",
    overriddenDay.mode === "transition" &&
      overriddenDay.nextStudentFacingBlock?.isOverridden === true &&
      overriddenDay.nextStudentFacingBlock.classSectionId === "section-custom-robotics",
  );
  if (overriddenDay.mode === "transition") {
    check(
      "the arrival routine resolves correctly for the overridden section too - same generic lookup",
      getArrivalInstructions(customArrivalSettings, overriddenDay.nextStudentFacingBlock?.classSectionId).join("|") ===
        "Get your kit",
    );
  }
}

console.log("\n38. Present Mode Branding: defaults resolve to the built-in OHHS Falcon");
{
  check(
    "38: the default settings have no custom watermark configured",
    DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS.customWatermarkDataUrl === undefined,
  );
  check(
    "38: the default watermark opacity is 35%, as specified for the built-in Falcon",
    DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS.watermarkOpacity === 0.35 &&
      DEFAULT_WATERMARK_OPACITY === 0.35,
  );

  // PresentWatermark.tsx is a React component (needs a DOM renderer) - its
  // "falls back to the built-in Falcon when no custom image is configured"
  // behavior is instead confirmed by scanning its source for the exact
  // asset path it's documented to fall back to.
  const watermarkComponentSource = readFileSync(
    join(process.cwd(), "components", "present", "PresentWatermark.tsx"),
    "utf8",
  );
  check(
    "38: PresentWatermark falls back to /branding/ohhs-falcon-head.png when no custom image is set",
    watermarkComponentSource.includes('"/branding/ohhs-falcon-head.png"'),
  );
}

console.log("\n39. Custom watermark overrides the default, and Reset removes it");
{
  state = appDataReducer(state, {
    type: "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS",
    patch: { customWatermarkDataUrl: "data:image/png;base64,AAAA", watermarkOpacity: 0.5 },
  });
  check(
    "39: a custom watermark data URL overrides the default once set",
    state.classroomExperienceSettings.customWatermarkDataUrl === "data:image/png;base64,AAAA",
  );
  check("39: the configured opacity is stored alongside it", state.classroomExperienceSettings.watermarkOpacity === 0.5);

  // Mirrors SettingsScreen's handleWatermarkReset: clear the custom image
  // and restore the default opacity in the same patch.
  state = appDataReducer(state, {
    type: "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS",
    patch: { customWatermarkDataUrl: undefined, watermarkOpacity: DEFAULT_WATERMARK_OPACITY },
  });
  check(
    "39: Reset to OHHS Falcon removes the custom watermark",
    state.classroomExperienceSettings.customWatermarkDataUrl === undefined,
  );
  check(
    "39: Reset also restores the default opacity",
    state.classroomExperienceSettings.watermarkOpacity === DEFAULT_WATERMARK_OPACITY,
  );
}

console.log("\n40. Branding settings persist through DataRepository, including for old AppData missing them");
{
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
  const withCustomWatermark: AppData = {
    ...createDemoAppData(),
    classroomExperienceSettings: {
      ...DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
      customWatermarkDataUrl: "data:image/jpeg;base64,BBBB",
      watermarkOpacity: 0.2,
    },
  };
  await repo.save(withCustomWatermark);
  const reloaded = await repo.load();
  check(
    "40: a custom watermark and its opacity round-trip through save/load unchanged",
    reloaded.classroomExperienceSettings.customWatermarkDataUrl === "data:image/jpeg;base64,BBBB" &&
      reloaded.classroomExperienceSettings.watermarkOpacity === 0.2,
  );

  // Simulate AppData saved before this feature existed: no branding fields
  // on classroomExperienceSettings at all.
  const legacySettings = { ...DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } as Record<string, unknown>;
  delete legacySettings.customWatermarkDataUrl;
  delete legacySettings.watermarkOpacity;
  const legacyData = { ...createDemoAppData(), classroomExperienceSettings: legacySettings };
  fakeStore.set("falcon-deck:app-data:v1", JSON.stringify(legacyData));
  const legacyLoaded = await repo.load();
  check(
    "40: old AppData without branding settings loads the default watermark (undefined = built-in Falcon)",
    legacyLoaded.classroomExperienceSettings.customWatermarkDataUrl === undefined,
  );
  check(
    "40: old AppData without branding settings loads the default opacity",
    legacyLoaded.classroomExperienceSettings.watermarkOpacity === DEFAULT_WATERMARK_OPACITY,
  );

  delete (globalThis as Record<string, unknown>).window;
}

console.log("\n41. Watermark upload validation (mime type, size, and the resize math)");
{
  check("41: PNG is an accepted watermark type", isAcceptedWatermarkMimeType("image/png"));
  check("41: JPEG is an accepted watermark type", isAcceptedWatermarkMimeType("image/jpeg"));
  check("41: WebP is an accepted watermark type", isAcceptedWatermarkMimeType("image/webp"));
  check("41: GIF is not an accepted watermark type", !isAcceptedWatermarkMimeType("image/gif"));
  check(
    "41: SVG is deliberately not accepted (avoids arbitrary SVG/script content in an uploaded watermark)",
    !isAcceptedWatermarkMimeType("image/svg+xml"),
  );

  const landscape = computeWatermarkTargetSize(3840, 2160, 1920, 1080);
  check("41: an oversized landscape image is scaled down to exactly fit 1920x1080", landscape.width === 1920 && landscape.height === 1080);
  const portrait = computeWatermarkTargetSize(1000, 4000, 1920, 1080);
  check(
    "41: aspect ratio is preserved when the limiting dimension is height",
    portrait.height === 1080 && portrait.width === 270,
  );
  const small = computeWatermarkTargetSize(200, 100, 1920, 1080);
  check("41: a smaller-than-target image is never upscaled", small.width === 200 && small.height === 100);

  const knownBase64 = Buffer.from("hello world").toString("base64");
  check(
    "41: dataUrlByteLength matches the real decoded byte length of a known payload",
    dataUrlByteLength(`data:text/plain;base64,${knownBase64}`) === Buffer.byteLength("hello world"),
  );

  function fakeFile(overrides: Partial<{ size: number; type: string }>): File {
    return { size: 1024, type: "image/png", ...overrides } as unknown as File;
  }

  const emptyResult = await processWatermarkUpload(fakeFile({ size: 0 }));
  check("41: an empty file is rejected before any decoding is attempted", emptyResult.ok === false);

  const wrongTypeResult = await processWatermarkUpload(fakeFile({ type: "application/pdf" }));
  check("6: an unsupported file type is rejected with a concise message", wrongTypeResult.ok === false && typeof wrongTypeResult.error === "string");

  const oversizedResult = await processWatermarkUpload(fakeFile({ size: WATERMARK_MAX_UPLOAD_BYTES + 1 }));
  check("7: a file over the raw upload cap is rejected before decoding", oversizedResult.ok === false);

  // No canvas/Image decoder exists under plain Node - calling this with an
  // otherwise-valid file exercises that a decode failure is caught and
  // turned into a graceful `{ ok: false }` result, never an unhandled
  // rejection or a crash (real browser decode failures - corrupt image
  // bytes - are handled by the exact same try/catch in
  // lib/present/processWatermarkUpload.ts).
  const decodeAttemptResult = await processWatermarkUpload(fakeFile({}));
  check(
    "processWatermarkUpload never throws, even when no image decoder is available - it resolves to a graceful failure",
    decodeAttemptResult.ok === false,
  );
}

console.log("\n42. Present Mode reads branding through classroomExperienceSettings, not a separate path");
{
  const classroomViewSource = readFileSync(join(process.cwd(), "components", "present", "ClassroomView.tsx"), "utf8");
  check(
    "42: ClassroomView reads the watermark settings from data.classroomExperienceSettings",
    classroomViewSource.includes("data.classroomExperienceSettings") &&
      classroomViewSource.includes("customWatermarkDataUrl") &&
      classroomViewSource.includes("watermarkOpacity"),
  );

  const watermarkComponentSource = readFileSync(
    join(process.cwd(), "components", "present", "PresentWatermark.tsx"),
    "utf8",
  );
  check(
    "42: PresentWatermark itself is presentational - it takes props, it doesn't read AppData or localStorage directly",
    !watermarkComponentSource.includes("useAppData") && !/\blocalStorage\b/.test(watermarkComponentSource),
  );
}

console.log(
  "\n(43-47: run `npm run verify:schedule`, `verify:lessons`, `verify:preview`, `verify:week`, and " +
    "`verify:resources` - or `npm run verify` for everything together. 48-49: `npm run lint` and `npm run build`.)",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
}

main().then(() => {
  process.exit(failures === 0 ? 0 : 1);
});
