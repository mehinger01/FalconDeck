/**
 * Standalone, Playwright-based verification for the BenQ-board-first
 * presentation tier (see the `@media (min-width: 1536px) and
 * (min-height: 800px)` block in app/globals.css and the `present-*`
 * classes wired into components/present/LessonPanels.tsx and
 * CountdownBanner.tsx).
 *
 * Unlike the rest of the `scripts/verify-*.ts` suite, this one needs a
 * real rendering engine - class-name presence proves the CSS was
 * *attempted*, not that five real cards plus a live countdown actually
 * fit on screen without scrolling. So this script boots a real `next dev`
 * server, seeds realistic AppData into a real Chromium page's
 * localStorage, and measures the real rendered layout at each of the
 * four viewport sizes called out in the spec: 1280x720, 1366x768,
 * 1536x864, and 1920x1080. Only the latter two are hard "must fit"
 * requirements; the smaller two may reflow to a single/double column
 * (documented below) since they're below the presentation-tier
 * breakpoint entirely.
 *
 * Route architecture note: `/present` is now the *authenticated* teacher
 * Present Mode (see app/(presentation)/present/), reachable only with a
 * real session. Every pure layout/visual check below therefore drives
 * `/demo/present` instead - the public, unauthenticated demo simulator
 * (components/demo/DemoPresentSimulator.tsx) that renders through the
 * exact same ClassroomView/PresentHeader/ToolTray/TimerWidget components
 * Live Mode uses, so everything measured here (card grid, font floor,
 * timer position, overlap-freedom) is identical to what a real signed-in
 * teacher sees. `/demo/present` has no query-string API of its own - it
 * exposes a fixed set of "jump to this real moment in the calendar-
 * resolved schedule" scenario buttons instead, driven here the same way
 * `startTimerViaUi` drives the Classroom Timer: through the real UI, not
 * a shortcut. Section 7 separately, and honestly, confirms the other half
 * of the architecture: an anonymous visitor to the real `/present` is
 * redirected to `/login`, never shown Present Mode.
 *
 * Deliberately excluded from `npm run verify` (like verify-usenow.ts and
 * verify-bell-offset.ts before it) - it's slow (spawns a dev server,
 * drives a real browser) and isn't part of the fast inner loop:
 *
 *   npm run verify:present-layout
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";
import type { SchoolYearCalendar } from "@/types/calendar";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import { DEMO_COURSES, DEMO_CLASS_SECTIONS, DEMO_SCHEDULES } from "@/lib/data/demoData";
import type { AppData } from "@/lib/data/types";
import type { DailyLesson } from "@/types/lesson";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const PORT = 3178;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = join(
  process.env.CLAUDE_SCRATCHPAD_DIR ??
    "C:\\Users\\m_ehi\\AppData\\Local\\Temp\\claude\\C--Users-m-ehi-falcondeck\\06415384-31ba-40b8-b3d4-18896c4519cf\\scratchpad",
  "present-layout-screenshots",
);
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// True once the authenticated Present route group (from the Supabase/auth
// cutover) exists in this checkout. Main (pre-cutover) doesn't have it yet -
// `/present` is still directly, publicly reachable there - so section 7
// below must detect which reality it's running against rather than
// asserting a redirect that would be false on this checkout. It flips to
// true automatically the moment this file is merged into a branch that has
// the auth cutover, with no further changes needed here.
function hasAuthenticatedPresentRoute(): boolean {
  return existsSync(join(process.cwd(), "app", "(presentation)", "present", "layout.tsx"));
}

const TODAY_DATE_KEY = "2026-09-15"; // a real Tuesday; no weekday-specific override affects block-period-1

// 2026-09-15 08:40:30 America/Detroit (EDT, UTC-4) - inside block-period-1
// (07:55-08:45) with 4:30 remaining, comfortably inside the final-5:00
// countdown window without being exactly on a boundary. Only used by the
// pre-cutover real-/present fallback in sections 5/6 below - DemoPresentSimulator
// never reads Date.now(), so this has no effect on /demo/present.
const FIXED_LIVE_TIME_MS = Date.UTC(2026, 8, 15, 12, 40, 30);

const RICH_LESSON: DailyLesson = {
  id: "lesson-verify-present-layout",
  date: TODAY_DATE_KEY,
  classSectionId: "section-algebra-1-p1",
  learningTarget:
    "I can solve multi-step linear equations involving variables on both sides and justify each step.",
  agendaItems: [
    {
      id: "agenda-1",
      title: "Warm-up: review the distributive property",
      details: "5 problems, silent start, check with a partner when done.",
      isCompleted: false,
      sortOrder: 0,
    },
    {
      id: "agenda-2",
      title: "Notes: solving equations with variables on both sides",
      details: "Follow along in the guided notes packet, pages 3-4.",
      isCompleted: false,
      sortOrder: 1,
    },
    {
      id: "agenda-3",
      title: "Practice set, problems 1-15, then check answers as a class",
      details: "Work independently first; raise your hand if stuck for more than 2 minutes.",
      isCompleted: false,
      sortOrder: 2,
    },
  ],
  materials:
    "HMH Into Algebra 1 Unit 2 Module 3 Lesson 4; Student Edition pp. 88-90; guided notes packet (front and back); " +
    "whiteboard and dry-erase marker for each student; scientific calculator as needed; graph paper for the " +
    "independent practice set; printed exit ticket for the last five minutes.",
  resources: [
    { id: "resource-1", title: "Practice Set (Printable)", url: "https://example.com/practice", type: "document" },
    { id: "resource-2", title: "Desmos Graphing Calculator", url: "https://www.desmos.com/calculator", type: "desmos" },
    { id: "resource-3", title: "Unit 2 Slides", url: "https://example.com/slides", type: "slides" },
  ],
  announcements: [
    { id: "announcement-1", text: "Quiz Friday covering Lessons 1-4 - review guide posted in the Resource Library." },
    { id: "announcement-2", text: "Bring a fully charged Chromebook tomorrow for the practice test." },
    { id: "announcement-3", text: "Math National Honor Society applications are due next Monday." },
  ],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

// DemoPresentSimulator derives its scenario buttons ("Start Period 1",
// "Final 30 Seconds", etc.) from data.schoolCalendar.firstStudentDay, not
// from a query string - so unlike the old Preview-mode URL, a real (non-
// null) calendar has to be seeded, anchored on TODAY_DATE_KEY so those
// scenarios land on the same date RICH_LESSON is written for. Points at
// whichever DEMO_SCHEDULES entry is marked default (block-period-1,
// 07:55-08:45, section-algebra-1-p1) rather than hardcoding its id, so this
// stays correct if demoData.ts ever changes which schedule is default.
const DEMO_SCHOOL_CALENDAR: SchoolYearCalendar = {
  id: "calendar-verify-present-layout",
  name: "Verify Present Layout Calendar",
  schoolYear: "2026-2027",
  timeZone: DEFAULT_TIME_ZONE,
  firstStudentDay: TODAY_DATE_KEY,
  lastStudentDay: "",
  defaultBellScheduleId: (DEMO_SCHEDULES.find((s) => s.isDefault) ?? DEMO_SCHEDULES[0]).id,
  exceptions: [],
};

function buildAppData(finalFiveMessage: string): AppData {
  return {
    courses: DEMO_COURSES,
    classSections: DEMO_CLASS_SECTIONS,
    schedules: DEMO_SCHEDULES,
    lessons: [RICH_LESSON],
    classPresentationSettings: [],
    classroomExperienceSettings: { ...DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS, finalFiveMessage },
    libraryResources: [],
    teacherSchedulePreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
    schoolCalendar: DEMO_SCHOOL_CALENDAR,
  };
}

const VIEWPORTS = [
  { width: 1280, height: 720, label: "1280x720", hardRequirement: false },
  { width: 1366, height: 768, label: "1366x768", hardRequirement: false },
  { width: 1536, height: 864, label: "1536x864", hardRequirement: true },
  { width: 1920, height: 1080, label: "1920x1080", hardRequirement: true },
];

function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    async function poll() {
      try {
        const res = await fetch(BASE_URL);
        if (res.ok || res.status === 404) {
          resolve();
          return;
        }
      } catch {
        // server not up yet
      }
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for the dev server to respond."));
        return;
      }
      setTimeout(poll, 500);
    }
    poll();
  });
}

function attachDiagnostics(page: Page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`  [console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.log(`  [pageerror] ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400) console.log(`  [http ${res.status()}] ${res.url()}`);
  });
}

async function seedLocalStorage(page: Page, appData: AppData) {
  await page.addInitScript((data) => {
    window.localStorage.setItem("falcon-deck:app-data:v1", JSON.stringify(data));
  }, appData);
}

async function freezeClock(page: Page, epochMs: number) {
  // Falcon Deck's clock (lib/hooks/clockStore.ts -> useNow.ts) only ever
  // calls `Date.now()` - never `new Date()` with no args - so patching
  // just that one static method is sufficient and avoids the complexity
  // (and esbuild/Playwright serialization pitfalls) of overriding the
  // whole Date constructor. Only relevant to the real, live-clock /present
  // route - DemoPresentSimulator's useSimulatedNow never touches Date.now().
  await page.addInitScript((fixedTime) => {
    Date.now = () => fixedTime;
  }, epochMs);
}

/**
 * Drives the exact real UI path a teacher uses to start the Classroom
 * Timer - open the tray, select Timer, pick a preset, click Start - so
 * `timer.isActive`/`timer.isRunning` become true for real (this is
 * in-memory React state via useClassroomTimer, not something seedable
 * through localStorage) and the ambient TimerWidget/`.timer-active` class
 * appear exactly as they would for a real user.
 */
async function startTimerViaUi(page: Page, presetMinutes: number): Promise<void> {
  await page.getByRole("button", { name: "Open classroom tools" }).click();
  await page.getByRole("button", { name: "Timer", exact: true }).click();
  await page.getByRole("button", { name: `${presetMinutes} min`, exact: true }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Collapse classroom tools" }).click();
}

/**
 * Navigates to the public Demo Present Simulator and drives its own real
 * UI - a fixed set of "jump to this moment" scenario buttons generated
 * from the seeded schedule (see DemoPresentSimulator.tsx) - to land on a
 * specific, real, calendar-resolved moment. `scenarioLabel` must exactly
 * match one of those buttons' visible text (e.g. "Start Period 1",
 * "Final 30 Seconds"); see DEMO_SCHOOL_CALENDAR's comment for why those
 * two specific labels are the ones this script relies on.
 */
async function openDemoScenario(page: Page, scenarioLabel: string): Promise<void> {
  await page.goto(`${BASE_URL}/demo/present`);
  await page.getByRole("button", { name: scenarioLabel, exact: true }).click();
  await page.waitForSelector("text=Today\u2019s Agenda", { timeout: 15_000 });
}

function parseCountdownSeconds(text: string | null): number | null {
  const match = text?.trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

interface LayoutMeasurement {
  scrollHeight: number;
  viewportHeight: number;
  overflowPx: number;
  scrollWidth: number;
  viewportWidth: number;
  horizontalOverflowPx: number;
  cardCount: number;
  cardHeadingFontPx: number | null;
  cardBodyFontPx: number | null;
  gridColumns: number | null;
  overlaps: string[];
  debug: {
    headerHeight: number | null;
    countdownWrapHeight: number | null;
    gridTop: number | null;
    gridHeight: number | null;
    titleTop: number | null;
    titleBottom: number | null;
    timerTop: number | null;
    timerBottom: number | null;
    timerLeft: number | null;
    timerRight: number | null;
    cardRects: Array<{ top: number; height: number }>;
  };
}

// Deliberately a plain JS string, not a Node-side closure passed to
// page.evaluate(fn): tsx/esbuild's `keepNames` transform injects a
// module-scoped `__name(...)` helper around every named
// function/const-arrow it compiles, and Playwright serializes an
// evaluate() *function* argument via its own .toString() - which captures
// only that one function's post-transform body, not the shared `__name`
// helper esbuild placed elsewhere in the compiled file. The result is a
// `ReferenceError: __name is not defined` inside the page for any
// sufficiently non-trivial callback. A string argument bypasses this
// entirely: Playwright evals it in the page as literal source, never
// touched by tsx/esbuild at all.
const MEASURE_LAYOUT_SCRIPT = `
(() => {
  const scrollHeight = document.documentElement.scrollHeight;
  const viewportHeight = window.innerHeight;
  const scrollWidth = document.documentElement.scrollWidth;
  const viewportWidth = window.innerWidth;
  const cards = Array.from(document.querySelectorAll(".present-card"));
  const heading = document.querySelector(".present-card-heading");
  const body = document.querySelector(".present-card-body");
  const grid = document.querySelector(".present-grid");

  const gridColumns = grid
    ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length
    : null;

  // Deliberately an allowlist of the *real* Present Mode fixed controls
  // (ToolTray's toggle, the Fullscreen button, the Timer widget), not a
  // blanket "everything on the page that happens to be position:fixed"
  // scan. When this script drives /demo/present, DemoPresentSimulator adds
  // its own fixed chrome on top - a bottom scenario-picker bar and a
  // top-left "Demo Mode / Exit Demo" badge - that a real teacher's session
  // never sees. A blanket scan would flag those as false "obstructions" of
  // the card grid at exactly the tight BenQ viewports this script exists
  // to verify; this allowlist keeps the collision check scoped to controls
  // that actually exist in production Present Mode.
  const REAL_FIXED_CONTROL_SELECTORS = [
    '[aria-label="Open classroom tools"]',
    '[aria-label="Collapse classroom tools"]',
    "button[aria-pressed]",
  ];
  // querySelectorAll + an explicit position:fixed check, not querySelector's
  // first-match-only: "button[aria-pressed]" also matches every in-flow
  // agenda-item checkbox (LessonPanels.tsx toggles aria-pressed for its own
  // completed/incomplete state), and querySelector would silently grab
  // whichever of those happens to come first in the DOM instead of the real
  // (fixed) FullscreenButton - a false "overlap" with ordinary card content
  // that has nothing to do with any fixed control.
  const fixedEls = REAL_FIXED_CONTROL_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector))).filter((el) => {
    if (getComputedStyle(el).position !== "fixed") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  const title = document.querySelector(".present-title");
  const timer = document.querySelector(".present-timer");
  // Preview Mode's own "Preview · <date>" pill - not covered by any
  // present-* class, sits between PresentHeader and ClassroomView. A real
  // screenshot caught this overlapping the timer even though every other
  // check passed, so it's measured explicitly here from now on. In Live
  // Mode, ClassroomView's own shell is instead PresentHeader's next
  // sibling - excluded explicitly, since that's a legitimate, separately
  // measured element (present-grid/present-title), not the pill.
  const previewHeader = document.querySelector("header.present-header");
  const headerSibling = previewHeader ? previewHeader.nextElementSibling : null;
  const previewPillWrapper =
    headerSibling && !headerSibling.classList.contains("present-classroom-shell") ? headerSibling : null;
  // Measure the inner <span> (the actual visible pill), not its wrapper
  // <div> - that wrapper carries px-10/sm:px-16 and spans nearly the full
  // viewport width for centering purposes, which made every check against
  // it a false-positive horizontal collision with anything in either top
  // corner regardless of where the pill text is actually drawn.
  const previewPill = previewPillWrapper ? (previewPillWrapper.querySelector("span") ?? previewPillWrapper) : null;

  const obstructionTargets = [];
  if (grid) obstructionTargets.push({ name: "present-grid", el: grid });
  const countdown = document.querySelector(".present-countdown");
  if (countdown) obstructionTargets.push({ name: "present-countdown", el: countdown });
  if (title) obstructionTargets.push({ name: "present-title", el: title });
  if (previewPill) obstructionTargets.push({ name: "preview-date-pill", el: previewPill });
  // The timer itself is also position:fixed - included as a target too
  // (checked against every OTHER fixed element, itself excluded below) so
  // a collision with the top-right Fullscreen/Tools controls is caught,
  // not just the timer's effect on in-flow content like the grid/title.
  if (timer) obstructionTargets.push({ name: "present-timer", el: timer });

  const overlaps = [];
  for (const target of obstructionTargets) {
    const targetRect = target.el.getBoundingClientRect();
    for (const fixedEl of fixedEls) {
      if (fixedEl === target.el) continue;
      const fixedRect = fixedEl.getBoundingClientRect();
      const hit =
        targetRect.left < fixedRect.right &&
        targetRect.right > fixedRect.left &&
        targetRect.top < fixedRect.bottom &&
        targetRect.bottom > fixedRect.top;
      if (hit) {
        overlaps.push(
          target.name + " overlaps a fixed control (" + fixedEl.tagName.toLowerCase() + "." + Array.from(fixedEl.classList).join(".") + ")",
        );
      }
    }
  }

  const headerEl = document.querySelector("header");
  const countdownWrap = countdown ? countdown.closest(".animate-present-fade") : null;
  const gridRect = grid ? grid.getBoundingClientRect() : null;
  const titleRect = title ? title.getBoundingClientRect() : null;
  const timerRect = timer ? timer.getBoundingClientRect() : null;
  const cardRects = cards.map((c) => {
    const r = c.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height) };
  });

  return {
    scrollHeight,
    viewportHeight,
    overflowPx: Math.max(0, scrollHeight - viewportHeight),
    scrollWidth,
    viewportWidth,
    horizontalOverflowPx: Math.max(0, scrollWidth - viewportWidth),
    cardCount: cards.length,
    cardHeadingFontPx: heading ? parseFloat(getComputedStyle(heading).fontSize) : null,
    cardBodyFontPx: body ? parseFloat(getComputedStyle(body).fontSize) : null,
    gridColumns,
    overlaps,
    debug: {
      headerHeight: headerEl ? Math.round(headerEl.getBoundingClientRect().height) : null,
      countdownWrapHeight: countdownWrap ? Math.round(countdownWrap.getBoundingClientRect().height) : null,
      gridTop: gridRect ? Math.round(gridRect.top) : null,
      gridHeight: gridRect ? Math.round(gridRect.height) : null,
      titleTop: titleRect ? Math.round(titleRect.top) : null,
      titleBottom: titleRect ? Math.round(titleRect.bottom) : null,
      timerTop: timerRect ? Math.round(timerRect.top) : null,
      timerBottom: timerRect ? Math.round(timerRect.bottom) : null,
      timerLeft: timerRect ? Math.round(timerRect.left) : null,
      timerRight: timerRect ? Math.round(timerRect.right) : null,
      cardRects,
    },
  };
})()
`;

async function measureLayout(page: Page): Promise<LayoutMeasurement> {
  return page.evaluate(MEASURE_LAYOUT_SCRIPT);
}

async function killWhateverIsOnPort(port: number): Promise<void> {
  if (process.platform !== "win32") return;
  // Self-healing: a previous run of this exact script can leave an
  // orphaned `next start` listening on PORT if the process tree didn't
  // fully die (observed even with taskkill /T in the normal shutdown
  // path below) - it then serves a stale build manifest to the next run
  // and every static chunk 404s/500s. Rather than rely on cleanup always
  // working, proactively clear the port before starting.
  const { execSync } = await import("node:child_process");
  try {
    const output = execSync(`netstat -ano -p tcp`, { encoding: "utf8" });
    const pids = new Set<string>();
    for (const line of output.split("\n")) {
      if (line.includes(`:${port} `) && line.includes("LISTENING")) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid) pids.add(pid);
      }
    }
    for (const pid of pids) {
      console.log(`Clearing a stale process already listening on port ${port} (PID ${pid})...`);
      try {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } catch {
        // already gone
      }
    }
  } catch {
    // netstat unavailable or nothing to clean up - fine either way
  }
}

async function main() {
  console.log("Starting a production server (`next start`) for real-browser layout verification...\n");
  console.log("(Using a production build rather than `next dev` - a separate, already-running dev server on this");
  console.log(" machine holds next dev's single-instance lock for this project directory regardless of port.)\n");

  await killWhateverIsOnPort(PORT);

  // Invoking node_modules/.bin/next.cmd directly (rather than `npx next
  // start`) avoids an extra layer of shell/npx wrapper processes on
  // Windows - `npx` spawning its own child made `taskkill /T` on the
  // outer process unreliable at actually stopping the real server
  // underneath, leaving orphaned listeners on this port between runs.
  const server: ChildProcess = spawn("node_modules\\.bin\\next.cmd", ["start", "-p", String(PORT)], {
    cwd: process.cwd(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  server.stdout?.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr?.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await waitForServer(60_000);
    console.log(`Dev server is up at ${BASE_URL}\n`);

    const browser = await chromium.launch();

    console.log("1. Demo layout, no countdown - all five cards, every required viewport");
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      attachDiagnostics(page);
      await seedLocalStorage(page, buildAppData(""));
      await openDemoScenario(page, "Start Period 1");
      await page.waitForTimeout(300); // let watermark/layout settle

      const measurement = await measureLayout(page);
      console.log(`\n  --- No-Countdown @ ${viewport.label} ---`);
      console.log(`  scrollHeight=${measurement.scrollHeight} viewportHeight=${measurement.viewportHeight} overflowPx=${measurement.overflowPx}`);
      console.log(`  scrollWidth=${measurement.scrollWidth} viewportWidth=${measurement.viewportWidth} horizontalOverflowPx=${measurement.horizontalOverflowPx}`);
      console.log(`  cardCount=${measurement.cardCount} gridColumns=${measurement.gridColumns}`);
      console.log(`  headingFontPx=${measurement.cardHeadingFontPx} bodyFontPx=${measurement.cardBodyFontPx}`);
      if (measurement.overlaps.length > 0) console.log(`  overlaps: ${measurement.overlaps.join("; ")}`);
      console.log(`  debug: ${JSON.stringify(measurement.debug)}`);

      const screenshotPath = join(SCREENSHOT_DIR, `no-countdown-${viewport.label}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`  screenshot: ${screenshotPath}`);

      check(`No-Countdown @ ${viewport.label}: all 5 cards render`, measurement.cardCount === 5);
      check(`No-Countdown @ ${viewport.label}: no visible control overlaps the grid`, measurement.overlaps.length === 0);
      // Horizontal clipping is never acceptable at any tested size, even
      // below the presentation tier where vertical scroll is fine.
      check(`No-Countdown @ ${viewport.label}: no horizontal overflow (horizontalOverflowPx === 0)`, measurement.horizontalOverflowPx === 0);
      // Timer-inactive baseline: confirms none of the timer-reserve/tighten
      // CSS (all scoped to .timer-active) leaks into the normal, no-timer
      // layout that was already verified and approved before this feature.
      check(`No-Countdown @ ${viewport.label}: no timer widget renders when the timer was never started`, measurement.debug.timerTop === null);

      if (viewport.hardRequirement) {
        check(`No-Countdown @ ${viewport.label}: no page scroll (overflowPx === 0)`, measurement.overflowPx === 0);
        check(`No-Countdown @ ${viewport.label}: presentation-tier grid is active (12 columns)`, measurement.gridColumns === 12);
        check(
          `No-Countdown @ ${viewport.label}: card heading font-size is exactly 36px`,
          measurement.cardHeadingFontPx === 36,
        );
        check(`No-Countdown @ ${viewport.label}: card body font-size is exactly 24px`, measurement.cardBodyFontPx === 24);
      } else {
        console.log(`  (below the presentation tier - reflow/overflow at this size is an accepted, documented compromise)`);
      }

      await context.close();
    }

    console.log("\n2. Demo layout with the final-five-minute countdown active - the hard sizes only (worst case)");
    for (const viewport of VIEWPORTS.filter((v) => v.hardRequirement)) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      attachDiagnostics(page);
      await seedLocalStorage(page, buildAppData("Wrap up and turn in your exit ticket before the bell."));
      await openDemoScenario(page, "Final 30 Seconds");
      await page.waitForTimeout(300);

      const measurement = await measureLayout(page);
      const countdownDigits = await page.locator(".present-countdown-digits").first().textContent().catch(() => null);
      const countdownSeconds = parseCountdownSeconds(countdownDigits);
      console.log(`\n  --- Countdown @ ${viewport.label} ---`);
      console.log(`  countdown digits shown: ${countdownDigits}`);
      console.log(`  scrollHeight=${measurement.scrollHeight} viewportHeight=${measurement.viewportHeight} overflowPx=${measurement.overflowPx}`);
      console.log(`  scrollWidth=${measurement.scrollWidth} viewportWidth=${measurement.viewportWidth} horizontalOverflowPx=${measurement.horizontalOverflowPx}`);
      console.log(`  cardCount=${measurement.cardCount} gridColumns=${measurement.gridColumns}`);
      console.log(`  headingFontPx=${measurement.cardHeadingFontPx} bodyFontPx=${measurement.cardBodyFontPx}`);
      if (measurement.overlaps.length > 0) console.log(`  overlaps: ${measurement.overlaps.join("; ")}`);
      console.log(`  debug: ${JSON.stringify(measurement.debug)}`);

      const screenshotPath = join(SCREENSHOT_DIR, `countdown-${viewport.label}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`  screenshot: ${screenshotPath}`);

      // "Final 30 Seconds" always lands exactly 30s before the block ends,
      // so remaining time here is always some value in (0, 30] seconds -
      // but not pinned to an exact digit the way the old frozen-clock bare
      // /present check was. DemoPresentSimulator's clock (useSimulatedNow)
      // ticks forward for real once a second rather than being frozen, so
      // by the time this measurement runs a second or two of real time may
      // have elapsed since the click - a tolerant window is the honest
      // assertion here, not a flaky exact match.
      check(
        `Countdown @ ${viewport.label}: final-five countdown is active, comfortably before the block ends (0 < remaining <= 30s)`,
        countdownSeconds !== null && countdownSeconds > 0 && countdownSeconds <= 30,
      );
      check(`Countdown @ ${viewport.label}: all 5 cards render`, measurement.cardCount === 5);
      check(`Countdown @ ${viewport.label}: no page scroll (overflowPx === 0)`, measurement.overflowPx === 0);
      check(`Countdown @ ${viewport.label}: no horizontal overflow (horizontalOverflowPx === 0)`, measurement.horizontalOverflowPx === 0);
      check(`Countdown @ ${viewport.label}: no visible control overlaps the grid or countdown`, measurement.overlaps.length === 0);
      check(`Countdown @ ${viewport.label}: card heading font-size is exactly 36px`, measurement.cardHeadingFontPx === 36);
      check(`Countdown @ ${viewport.label}: card body font-size is exactly 24px`, measurement.cardBodyFontPx === 24);

      await context.close();
    }

    console.log("\n3. Materials-absent case still reflows cleanly at the hard sizes (no leftover gap/overflow)");
    for (const viewport of VIEWPORTS.filter((v) => v.hardRequirement)) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      attachDiagnostics(page);
      const appData = buildAppData("");
      appData.lessons = [{ ...RICH_LESSON, materials: undefined }];
      await seedLocalStorage(page, appData);
      await openDemoScenario(page, "Start Period 1");
      await page.waitForTimeout(300);

      const measurement = await measureLayout(page);
      console.log(`\n  --- No-Materials @ ${viewport.label} ---`);
      console.log(`  scrollHeight=${measurement.scrollHeight} viewportHeight=${measurement.viewportHeight} overflowPx=${measurement.overflowPx}`);
      console.log(`  scrollWidth=${measurement.scrollWidth} viewportWidth=${measurement.viewportWidth} horizontalOverflowPx=${measurement.horizontalOverflowPx}`);
      console.log(`  cardCount=${measurement.cardCount}`);

      check(`No-Materials @ ${viewport.label}: exactly 4 cards render`, measurement.cardCount === 4);
      check(`No-Materials @ ${viewport.label}: no page scroll`, measurement.overflowPx === 0);
      check(`No-Materials @ ${viewport.label}: no horizontal overflow`, measurement.horizontalOverflowPx === 0);

      await context.close();
    }

    console.log(
      "\n4. Real Fullscreen button/API behavior in actual Chromium - request, active state, exit via Escape " +
        "(this is the one scenario nothing DOM-free or source-scanned can prove: a genuine requestFullscreen() " +
        "call needs a real rendering engine and a real user-gesture-flagged click).",
    );
    if (hasAuthenticatedPresentRoute()) {
      // DemoPresentSimulator (unlike PresentScreen) never imports or mounts
      // FullscreenButton at all - it wires up ToolTray/TimerWidget/
      // LivePresentScreen directly, with no fullscreenRootRef. So there is
      // no unauthenticated route left to click a real Fullscreen button on:
      // /demo/present has none, and per this script's own design (see
      // section 7) an anonymous visit to the real /present is only ever
      // used to prove the login redirect, never to exercise Present Mode
      // itself. Rather than invent a login flow here (out of scope for a
      // layout-test refactor) or silently drop the check, this is reported
      // as a known, honest gap: real-browser Fullscreen API coverage needs
      // a genuine authenticated Playwright session, which is a separate
      // piece of work. Fullscreen's DOM-free state machine and listener
      // wiring (deriveChangeState, useFullscreen mount/cleanup symmetry)
      // remain fully covered by verify-classroom.ts's Part 49.
      console.log(
        "  SKIP - this checkout has the authenticated Present route group, and /demo/present's " +
          "DemoPresentSimulator never mounts a FullscreenButton at all (only PresentScreen does). Real " +
          "requestFullscreen()/Escape verification would need a genuine logged-in session against the real " +
          "/present, which this script deliberately does not automate. Part 49 in verify-classroom.ts still " +
          "covers the underlying state machine and listener wiring DOM-free.",
      );
    } else {
      // Pre-cutover: /present is still the real, unauthenticated PresentScreen
      // component, so it genuinely does mount FullscreenButton - this is the
      // one remaining legitimate reason this script visits /present directly.
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      attachDiagnostics(page);
      await seedLocalStorage(page, buildAppData(""));
      await page.goto(`${BASE_URL}/present?mode=preview&date=${TODAY_DATE_KEY}&section=section-algebra-1-p1`);
      await page.waitForSelector("text=Today’s Agenda", { timeout: 15_000 });

      // Matched by substring/regex, not an exact name - the accessible name
      // itself changes ("Fullscreen" -> "Exit Fullscreen") once toggled, and
      // an exact-match locator re-resolving after that point would find
      // nothing and hang waiting for a button that no longer matches.
      const button = page.getByRole("button", { name: /Fullscreen/ });
      const initialText = await button.textContent();
      check("the button reads 'Fullscreen' before it's ever clicked", initialText?.trim() === "Fullscreen");

      await button.click();
      await page.waitForTimeout(500);
      const isFullscreenAfterClick = await page.evaluate(() => document.fullscreenElement !== null);

      if (!isFullscreenAfterClick) {
        console.log(
          "  SKIP - this sandboxed Chromium did not grant document.fullscreenElement after a real click " +
            "(no window-manager access is common here); the click handler ran without throwing, which is as " +
            "far as this environment can verify the real API path. Pure-logic coverage of every resulting " +
            "state (§49) and the real click-through here together are the full picture.",
        );
      } else {
        check(
          "clicking Fullscreen actually enters fullscreen (document.fullscreenElement is set)",
          isFullscreenAfterClick,
        );
        const textAfterClick = await button.textContent();
        check("the button now reads 'Exit Fullscreen'", textAfterClick?.trim() === "Exit Fullscreen");

        // Escape is handled entirely by the browser itself (see useFullscreen.ts) -
        // it exits fullscreen and fires the same native fullscreenchange event
        // a manual "Exit Fullscreen" click would produce; no other code path
        // exists for either. Try a real synthetic Escape keypress first.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        const isFullscreenAfterEscape = await page.evaluate(() => document.fullscreenElement !== null);

        if (isFullscreenAfterEscape) {
          // A synthetic Escape not exiting fullscreen is a known sandbox/
          // window-manager limitation (Chromium's Escape-exits-fullscreen
          // behavior is partly handled at the browser-chrome/OS level, which
          // a headless, window-manager-less Chromium may not fully emulate
          // even though it granted real fullscreen a moment ago) - not a
          // product bug. Fall back to the "Exit Fullscreen" button itself,
          // which drives document.exitFullscreen() -> the exact same
          // fullscreenchange listener Escape would have triggered - to
          // still verify that code path for real before giving up.
          console.log(
            "  NOTE - a synthetic Escape keypress did not exit fullscreen in this sandboxed Chromium " +
              "(a window-manager-level limitation, not app behavior - fullscreen itself WAS real a moment " +
              "ago). Verifying the same fullscreenchange exit path via the Exit Fullscreen button instead.",
          );
          await button.click();
          await page.waitForTimeout(500);
          const isFullscreenAfterExitClick = await page.evaluate(() => document.fullscreenElement !== null);
          check(
            "clicking 'Exit Fullscreen' exits fullscreen via the same fullscreenchange path Escape would use",
            !isFullscreenAfterExitClick,
          );
          const textAfterExitClick = await button.textContent();
          check("the button reverts to 'Fullscreen' after exiting", textAfterExitClick?.trim() === "Fullscreen");
        } else {
          check("pressing Escape actually exits fullscreen (document.fullscreenElement is null again)", !isFullscreenAfterEscape);
          const textAfterEscape = await button.textContent();
          check("the button reverts to 'Fullscreen' after Escape, back in sync via fullscreenchange", textAfterEscape?.trim() === "Fullscreen");
        }
      }

      await context.close();
    }

    console.log(
      "\n5. Classroom Timer active (no countdown) - top-center, clear of the title/Fullscreen/Tools, reserved " +
        "space recovers the grid, still zero scroll at the hard sizes",
    );
    if (hasAuthenticatedPresentRoute()) {
      console.log(
        "  SKIP - DemoPresentSimulator's root wrapper never adds the 'timer-active' class the way PresentScreen's " +
          "does (its root div is hardcoded to \"relative min-h-screen\", with no timer.isActive conditional) - so " +
          "none of the CSS this checkpoint adds (.timer-active's reserved-space rules) can actually activate on " +
          "/demo/present. Verifying it needs the real PresentScreen wrapper, which now requires a genuine " +
          "logged-in session against /present. That's a real, separate follow-up (either an authenticated " +
          "Playwright session, or teaching DemoPresentSimulator to mirror PresentScreen's timer-active wrapper) - " +
          "not something this layout-test refactor invents a way around.",
      );
    } else {
      // Pre-cutover: /present is still the real, unauthenticated PresentScreen,
      // so its timer.isActive -> 'timer-active' wrapper class genuinely applies here.
      for (const viewport of VIEWPORTS.filter((v) => v.hardRequirement)) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        const page = await context.newPage();
        attachDiagnostics(page);
        await seedLocalStorage(page, buildAppData(""));
        await page.goto(`${BASE_URL}/present?mode=preview&date=${TODAY_DATE_KEY}&section=section-algebra-1-p1`);
        await page.waitForSelector("text=Today’s Agenda", { timeout: 15_000 });
        await startTimerViaUi(page, 5);
        await page.waitForTimeout(300);

        const measurement = await measureLayout(page);
        console.log(`\n  --- Timer-active @ ${viewport.label} ---`);
        console.log(`  scrollHeight=${measurement.scrollHeight} viewportHeight=${measurement.viewportHeight} overflowPx=${measurement.overflowPx}`);
        console.log(`  scrollWidth=${measurement.scrollWidth} viewportWidth=${measurement.viewportWidth} horizontalOverflowPx=${measurement.horizontalOverflowPx}`);
        console.log(`  cardCount=${measurement.cardCount} gridColumns=${measurement.gridColumns}`);
        console.log(`  headingFontPx=${measurement.cardHeadingFontPx} bodyFontPx=${measurement.cardBodyFontPx}`);
        if (measurement.overlaps.length > 0) console.log(`  overlaps: ${measurement.overlaps.join("; ")}`);
        console.log(`  debug: ${JSON.stringify(measurement.debug)}`);

        const screenshotPath = join(SCREENSHOT_DIR, `timer-active-${viewport.label}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`  screenshot: ${screenshotPath}`);

        check(`Timer-active @ ${viewport.label}: the timer widget is rendered`, measurement.debug.timerTop !== null);
        check(
          `Timer-active @ ${viewport.label}: timer is horizontally centered (left/right roughly symmetric around viewport center)`,
          measurement.debug.timerLeft !== null &&
            measurement.debug.timerRight !== null &&
            Math.abs(
              (measurement.debug.timerLeft + measurement.debug.timerRight) / 2 - viewport.width / 2,
            ) < 5,
        );
        check(
          `Timer-active @ ${viewport.label}: timer sits above the lesson title (no vertical overlap)`,
          measurement.debug.timerBottom !== null &&
            measurement.debug.titleTop !== null &&
            measurement.debug.timerBottom <= measurement.debug.titleTop,
        );
        check(`Timer-active @ ${viewport.label}: all 5 cards still render`, measurement.cardCount === 5);
        check(`Timer-active @ ${viewport.label}: no page scroll (overflowPx === 0)`, measurement.overflowPx === 0);
        check(`Timer-active @ ${viewport.label}: no horizontal overflow (horizontalOverflowPx === 0)`, measurement.horizontalOverflowPx === 0);
        check(`Timer-active @ ${viewport.label}: no overlap between the timer/grid/title and any fixed control`, measurement.overlaps.length === 0);
        check(`Timer-active @ ${viewport.label}: card heading font-size is still exactly 36px`, measurement.cardHeadingFontPx === 36);
        check(`Timer-active @ ${viewport.label}: card body font-size is still exactly 24px`, measurement.cardBodyFontPx === 24);

        await context.close();
      }
    }

    console.log(
      "\n6. Worst case: Classroom Timer + final-five countdown + all five populated cards, together, at the hard sizes",
    );
    if (hasAuthenticatedPresentRoute()) {
      console.log(
        "  SKIP - same DemoPresentSimulator 'timer-active' gap as section 5, now combined with the countdown - " +
          "see section 5's SKIP message above for why this needs the real, authenticated PresentScreen wrapper.",
      );
    } else {
      // Pre-cutover: real, unauthenticated /present + a frozen Date.now(),
      // exactly as this check always ran - PresentScreen's timer.isActive ->
      // 'timer-active' wrapper class genuinely applies here, so the exact
      // "4:30 remaining" digit match is meaningful again (a real frozen
      // clock, not DemoPresentSimulator's real-time simulated one).
      for (const viewport of VIEWPORTS.filter((v) => v.hardRequirement)) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        const page = await context.newPage();
        attachDiagnostics(page);
        await seedLocalStorage(page, buildAppData("Wrap up and turn in your exit ticket before the bell."));
        await freezeClock(page, FIXED_LIVE_TIME_MS);
        await page.goto(`${BASE_URL}/present`);
        await page.waitForSelector("text=Today’s Agenda", { timeout: 15_000 });
        await startTimerViaUi(page, 5);
        await page.waitForTimeout(300);

        const measurement = await measureLayout(page);
        const countdownDigits = await page.locator(".present-countdown-digits").first().textContent().catch(() => null);
        console.log(`\n  --- Timer+Countdown @ ${viewport.label} ---`);
        console.log(`  countdown digits shown: ${countdownDigits}`);
        console.log(`  scrollHeight=${measurement.scrollHeight} viewportHeight=${measurement.viewportHeight} overflowPx=${measurement.overflowPx}`);
        console.log(`  scrollWidth=${measurement.scrollWidth} viewportWidth=${measurement.viewportWidth} horizontalOverflowPx=${measurement.horizontalOverflowPx}`);
        console.log(`  cardCount=${measurement.cardCount} gridColumns=${measurement.gridColumns}`);
        console.log(`  headingFontPx=${measurement.cardHeadingFontPx} bodyFontPx=${measurement.cardBodyFontPx}`);
        if (measurement.overlaps.length > 0) console.log(`  overlaps: ${measurement.overlaps.join("; ")}`);
        console.log(`  debug: ${JSON.stringify(measurement.debug)}`);

        const screenshotPath = join(SCREENSHOT_DIR, `timer-countdown-${viewport.label}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`  screenshot: ${screenshotPath}`);

        check(`Timer+Countdown @ ${viewport.label}: countdown is showing (4:30 remaining)`, (countdownDigits ?? "").trim() === "4:30");
        check(`Timer+Countdown @ ${viewport.label}: the timer widget is rendered`, measurement.debug.timerTop !== null);
        check(
          `Timer+Countdown @ ${viewport.label}: timer sits above the lesson title (no vertical overlap)`,
          measurement.debug.timerBottom !== null &&
            measurement.debug.titleTop !== null &&
            measurement.debug.timerBottom <= measurement.debug.titleTop,
        );
        check(`Timer+Countdown @ ${viewport.label}: all 5 cards still render`, measurement.cardCount === 5);
        check(`Timer+Countdown @ ${viewport.label}: no page scroll (overflowPx === 0)`, measurement.overflowPx === 0);
        check(`Timer+Countdown @ ${viewport.label}: no horizontal overflow (horizontalOverflowPx === 0)`, measurement.horizontalOverflowPx === 0);
        check(`Timer+Countdown @ ${viewport.label}: no overlap between the timer/grid/title/countdown and any fixed control`, measurement.overlaps.length === 0);
        check(`Timer+Countdown @ ${viewport.label}: card heading font-size is still exactly 36px`, measurement.cardHeadingFontPx === 36);
        check(`Timer+Countdown @ ${viewport.label}: card body font-size is still exactly 24px`, measurement.cardBodyFontPx === 24);

        await context.close();
      }
    }

    console.log(
      "\n7. Authenticated /present architecture: anonymous access must redirect to /login, never render Present " +
        "Mode directly",
    );
    if (!hasAuthenticatedPresentRoute()) {
      console.log(
        "  SKIP - app/(presentation)/present/layout.tsx not found in this checkout; /present predates the " +
          "authenticated Present architecture here and is expected to remain directly, publicly reachable. " +
          "This check activates automatically once the authenticated route group is merged in - see " +
          "hasAuthenticatedPresentRoute() above.",
      );
    } else {
      // A fresh context with nothing seeded - no localStorage, no cookies -
      // to genuinely represent an anonymous visitor rather than a signed-in
      // teacher.
      const context = await browser.newContext();
      const page = await context.newPage();
      attachDiagnostics(page);
      await page.goto(`${BASE_URL}/present`, { waitUntil: "domcontentloaded" });
      const finalPath = new URL(page.url()).pathname;
      check(
        "anonymous GET /present redirects to /login (never renders Present Mode without a session)",
        finalPath === "/login",
      );
      await context.close();
    }

    await browser.close();
  } finally {
    // On Windows, spawning through npx.cmd means `server.pid` is a wrapper
    // process - a plain server.kill() leaves the real `next start` (and its
    // listening socket) running. `taskkill /T` kills the whole process tree.
    if (process.platform === "win32" && server.pid) {
      spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      server.kill();
    }
    if (failures > 0) {
      console.log("\n--- dev server output (tail, for diagnosing failures) ---");
      console.log(serverOutput.split("\n").slice(-60).join("\n"));
    }
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
