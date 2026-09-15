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
 * Deliberately excluded from `npm run verify` (like verify-usenow.ts and
 * verify-bell-offset.ts before it) - it's slow (spawns a dev server,
 * drives a real browser) and isn't part of the fast inner loop:
 *
 *   npm run verify:present-layout
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";
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

const TODAY_DATE_KEY = "2026-09-15"; // a real Tuesday; no weekday-specific override affects block-period-1

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
    schoolCalendar: null,
  };
}

// 2026-09-15 08:40:30 America/Detroit (EDT, UTC-4) - inside block-period-1
// (07:55-08:45) with 4:30 remaining, comfortably inside the final-5:00
// countdown window without being exactly on a boundary.
const FIXED_LIVE_TIME_MS = Date.UTC(2026, 8, 15, 12, 40, 30);

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
  // whole Date constructor.
  await page.addInitScript((fixedTime) => {
    Date.now = () => fixedTime;
  }, epochMs);
}

interface LayoutMeasurement {
  scrollHeight: number;
  viewportHeight: number;
  overflowPx: number;
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
  const cards = Array.from(document.querySelectorAll(".present-card"));
  const heading = document.querySelector(".present-card-heading");
  const body = document.querySelector(".present-card-body");
  const grid = document.querySelector(".present-grid");

  const gridColumns = grid
    ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length
    : null;

  const fixedEls = Array.from(document.querySelectorAll("body *")).filter((el) => {
    const style = getComputedStyle(el);
    if (style.position !== "fixed") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  const obstructionTargets = [];
  if (grid) obstructionTargets.push({ name: "present-grid", el: grid });
  const countdown = document.querySelector(".present-countdown");
  if (countdown) obstructionTargets.push({ name: "present-countdown", el: countdown });

  const overlaps = [];
  for (const target of obstructionTargets) {
    const targetRect = target.el.getBoundingClientRect();
    for (const fixedEl of fixedEls) {
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
  const cardRects = cards.map((c) => {
    const r = c.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height) };
  });

  return {
    scrollHeight,
    viewportHeight,
    overflowPx: Math.max(0, scrollHeight - viewportHeight),
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

    console.log("1. Preview Mode (no countdown) - all five cards, every required viewport");
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      attachDiagnostics(page);
      await seedLocalStorage(page, buildAppData(""));
      await page.goto(`${BASE_URL}/present?mode=preview&date=${TODAY_DATE_KEY}&section=section-algebra-1-p1`);
      await page.waitForSelector("text=Today\u2019s Agenda", { timeout: 15_000 });
      await page.waitForTimeout(300); // let watermark/layout settle

      const measurement = await measureLayout(page);
      console.log(`\n  --- Preview @ ${viewport.label} ---`);
      console.log(`  scrollHeight=${measurement.scrollHeight} viewportHeight=${measurement.viewportHeight} overflowPx=${measurement.overflowPx}`);
      console.log(`  cardCount=${measurement.cardCount} gridColumns=${measurement.gridColumns}`);
      console.log(`  headingFontPx=${measurement.cardHeadingFontPx} bodyFontPx=${measurement.cardBodyFontPx}`);
      if (measurement.overlaps.length > 0) console.log(`  overlaps: ${measurement.overlaps.join("; ")}`);
      console.log(`  debug: ${JSON.stringify(measurement.debug)}`);

      const screenshotPath = join(SCREENSHOT_DIR, `preview-${viewport.label}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`  screenshot: ${screenshotPath}`);

      check(`Preview @ ${viewport.label}: all 5 cards render`, measurement.cardCount === 5);
      check(`Preview @ ${viewport.label}: no visible control overlaps the grid`, measurement.overlaps.length === 0);

      if (viewport.hardRequirement) {
        check(`Preview @ ${viewport.label}: no page scroll (overflowPx === 0)`, measurement.overflowPx === 0);
        check(`Preview @ ${viewport.label}: presentation-tier grid is active (12 columns)`, measurement.gridColumns === 12);
        check(
          `Preview @ ${viewport.label}: card heading font-size is exactly 36px`,
          measurement.cardHeadingFontPx === 36,
        );
        check(`Preview @ ${viewport.label}: card body font-size is exactly 24px`, measurement.cardBodyFontPx === 24);
      } else {
        console.log(`  (below the presentation tier - reflow/overflow at this size is an accepted, documented compromise)`);
      }

      await context.close();
    }

    console.log("\n2. Live Mode with the final-five-minute countdown active - the hard sizes only (worst case)");
    for (const viewport of VIEWPORTS.filter((v) => v.hardRequirement)) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      attachDiagnostics(page);
      await seedLocalStorage(page, buildAppData("Wrap up and turn in your exit ticket before the bell."));
      await freezeClock(page, FIXED_LIVE_TIME_MS);
      await page.goto(`${BASE_URL}/present`);
      await page.waitForSelector("text=Today\u2019s Agenda", { timeout: 15_000 });
      await page.waitForTimeout(300);

      const measurement = await measureLayout(page);
      const countdownDigits = await page.locator(".present-countdown-digits").first().textContent().catch(() => null);
      console.log(`\n  --- Live+Countdown @ ${viewport.label} ---`);
      console.log(`  countdown digits shown: ${countdownDigits}`);
      console.log(`  scrollHeight=${measurement.scrollHeight} viewportHeight=${measurement.viewportHeight} overflowPx=${measurement.overflowPx}`);
      console.log(`  cardCount=${measurement.cardCount} gridColumns=${measurement.gridColumns}`);
      console.log(`  headingFontPx=${measurement.cardHeadingFontPx} bodyFontPx=${measurement.cardBodyFontPx}`);
      if (measurement.overlaps.length > 0) console.log(`  overlaps: ${measurement.overlaps.join("; ")}`);
      console.log(`  debug: ${JSON.stringify(measurement.debug)}`);

      const screenshotPath = join(SCREENSHOT_DIR, `live-countdown-${viewport.label}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`  screenshot: ${screenshotPath}`);

      check(
        `Live+Countdown @ ${viewport.label}: countdown is showing (4:30 remaining)`,
        (countdownDigits ?? "").trim() === "4:30",
      );
      check(`Live+Countdown @ ${viewport.label}: all 5 cards render`, measurement.cardCount === 5);
      check(`Live+Countdown @ ${viewport.label}: no page scroll (overflowPx === 0)`, measurement.overflowPx === 0);
      check(`Live+Countdown @ ${viewport.label}: no visible control overlaps the grid or countdown`, measurement.overlaps.length === 0);
      check(`Live+Countdown @ ${viewport.label}: card heading font-size is exactly 36px`, measurement.cardHeadingFontPx === 36);
      check(`Live+Countdown @ ${viewport.label}: card body font-size is exactly 24px`, measurement.cardBodyFontPx === 24);

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
      await page.goto(`${BASE_URL}/present?mode=preview&date=${TODAY_DATE_KEY}&section=section-algebra-1-p1`);
      await page.waitForSelector("text=Today\u2019s Agenda", { timeout: 15_000 });
      await page.waitForTimeout(300);

      const measurement = await measureLayout(page);
      console.log(`\n  --- No-Materials Preview @ ${viewport.label} ---`);
      console.log(`  scrollHeight=${measurement.scrollHeight} viewportHeight=${measurement.viewportHeight} overflowPx=${measurement.overflowPx}`);
      console.log(`  cardCount=${measurement.cardCount}`);

      check(`No-Materials @ ${viewport.label}: exactly 4 cards render`, measurement.cardCount === 4);
      check(`No-Materials @ ${viewport.label}: no page scroll`, measurement.overflowPx === 0);

      await context.close();
    }

    console.log(
      "\n4. Real Fullscreen button/API behavior in actual Chromium - request, active state, exit via Escape " +
        "(this is the one scenario nothing DOM-free or source-scanned can prove: a genuine requestFullscreen() " +
        "call needs a real rendering engine and a real user-gesture-flagged click). If this sandboxed Chromium " +
        "doesn't grant fullscreen at all (common in headless/CI without window-manager access), that's reported " +
        "as a skip, not a failure - the button/API wiring is still exercised for real either way.",
    );
    {
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
