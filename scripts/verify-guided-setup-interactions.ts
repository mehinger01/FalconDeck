/**
 * Real-browser interaction checks for guided setup: the actual GuidedSetup
 * component, bundled with esbuild and driven by Playwright's Chromium with
 * an in-memory repository (scripts/support/guidedSetupHarness.tsx). No Next
 * server, no network, no database. Focuses on what unit tests cannot see:
 * typed text that has not been committed yet (DraftTextInput's ~700 ms
 * debounce) racing Enter, Continue, removals, schedule switches and
 * conflicts - and completion: one commit however often Start is pressed,
 * retries and lost answers under the same operation id, and each
 * conflict's recovery.
 *
 *   npm run verify:guided-setup-interactions
 */
import { build } from "esbuild";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { GuidedSetupProps } from "@/components/guided/GuidedSetup";
import { baseAppData } from "@/lib/onboarding/review";
import { snapshotSharedBlocks } from "@/lib/onboarding/setupDraft";
import type { SchoolYearCalendar } from "@/types/calendar";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok  - ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  - ${label}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  }
}

const SCHOOL: BellSchedule = {
  id: "s-regular",
  name: "Regular Day",
  ownerType: "organization",
  isDefault: false,
  timeZone: "America/Detroit",
  source: "built-in",
  blocks: [
    { id: "p1", label: "1st Hour", kind: "instructional", startTime: "08:00", endTime: "08:50", overrides: [] },
    { id: "p2", label: "2nd Hour", kind: "instructional", startTime: "08:55", endTime: "09:45", overrides: [] },
  ],
};

/** A school calendar with one no-school day - the only source of "is this a school day" the screen may use. */
const CALENDAR: SchoolYearCalendar = {
  id: "cal-1",
  name: "2026-27",
  schoolYear: "2026-2027",
  timeZone: "America/Detroit",
  firstStudentDay: "2026-08-31",
  lastStudentDay: "2027-06-11",
  defaultBellScheduleId: "",
  exceptions: [{ id: "x1", startDate: "2026-10-23", endDate: "2026-10-23", type: "no-school", title: "Professional Development Day" }],
};

/** A resumed draft: the teacher's own three-period schedule, Geometry in Period 1. */
function ownDraft(): SetupDraft {
  return {
    version: 1,
    step: "teaching-day",
    courses: [{ id: "course-geo", name: "Geometry" }],
    classSections: [{ id: "section-geo-1", courseId: "course-geo", name: "Geometry — Period 1" }],
    schedule: {
      mode: "own",
      id: "schedule-own",
      name: "My Day",
      timeZone: "America/Detroit",
      blocks: [
        { id: "b1", label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: "section-geo-1" },
        { id: "b2", label: "Period 2", kind: "instructional", startTime: "08:55", endTime: "09:45", classSectionId: null },
        { id: "b3", label: "Period 3", kind: "instructional", startTime: "09:50", endTime: "10:40", classSectionId: null },
      ],
    },
    lunchWave: "none",
    firstLesson: null,
  };
}

function props(draft: SetupDraft, schoolCalendar: SchoolYearCalendar | null = null): Pick<GuidedSetupProps, "setupState" | "schoolSchedules" | "schoolCourses" | "schoolCalendar"> {
  return {
    setupState: { status: "in-progress", draft: { operationId: "op-1", revision: 1, updatedAt: new Date().toISOString(), payload: draft } },
    schoolSchedules: [SCHOOL],
    schoolCourses: [],
    schoolCalendar,
  };
}

let bundled = "";
async function bundle(): Promise<string> {
  const result = await build({
    entryPoints: [join(process.cwd(), "scripts/support/guidedSetupHarness.tsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    tsconfig: join(process.cwd(), "tsconfig.json"),
    banner: { js: "var process = { env: { NODE_ENV: 'development' } };" },
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
    plugins: [
      {
        // next/image needs Next's image config; the harness renders a plain <img>.
        name: "stub-next-image",
        setup(build) {
          build.onResolve({ filter: /^next\/image$/ }, () => ({ path: "next-image-stub", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents:
              "import { createElement } from 'react'; export default function Image(p) { return createElement('img', { src: typeof p.src === 'string' ? p.src : (p.src && p.src.src) || '', alt: p.alt, width: p.width, height: p.height, className: p.className }); }",
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

async function mount(browser: Browser, draft: SetupDraft, schoolCalendar: SchoolYearCalendar | null = null): Promise<Page> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __HARNESS: unknown }).__HARNESS = value;
  }, props(draft, schoolCalendar));
  await page.addScriptTag({ content: bundled });
  await page.getByRole("heading", { level: 1 }).waitFor();
  if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
  return page;
}

const indicator = (page: Page) => page.locator("header [role=status], header [role=alert]").first().innerText();
const stored = (page: Page) => page.evaluate(() => (window as unknown as { __repo: { stored: { revision: number; payload: SetupDraft } | null } }).__repo.stored);
const saves = (page: Page) => page.evaluate(() => (window as unknown as { __repo: { saves: Array<{ payload: SetupDraft }> } }).__repo.saves);
const periodLabels = (draft: SetupDraft | undefined) => (draft?.schedule?.mode === "own" ? draft.schedule.blocks.map((b) => b.label) : []);
const periodName = (page: Page, index: number) => page.getByLabel("Period name").nth(index);

async function scenarioEnterBeforeDebounce(browser: Browser) {
  console.log("1. Typing then Enter before the 700 ms pause");
  const page = await mount(browser, ownDraft());
  const field = page.getByLabel("Schedule name").first();
  await field.click();
  await field.fill("Fast Name");
  await field.press("Enter");
  await page.waitForTimeout(250);
  const after = await stored(page);
  check("Enter commits at once: the saved draft has the new name within 250 ms", after?.payload.schedule?.mode === "own" && after.payload.schedule.name === "Fast Name", after?.payload.schedule);
  await page.waitForTimeout(1000);
  check("...and nothing is saved again when the old timer would have fired", (await saves(page)).length === 1);
  check("...and the indicator settles on \"All changes saved\"", (await indicator(page)) === "All changes saved");
  await page.close();
}

async function scenarioContinueBeforeDebounce(browser: Browser) {
  console.log("2. Typing then Continue before the 700 ms pause");
  const page = await mount(browser, ownDraft());
  await periodName(page, 0).click();
  await periodName(page, 0).fill("Homeroom");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(300);
  const after = await stored(page);
  check("Continue commits the typed text before checking the step", periodLabels(after?.payload)[0] === "Homeroom", periodLabels(after?.payload));
  check("...renaming the class with it", after?.payload.classSections[0]?.name === "Geometry — Homeroom", after?.payload.classSections);
  await page.waitForTimeout(1000);
  check("...with no unsaved text left behind", (await indicator(page)) === "All changes saved");
  await page.close();
}

async function scenarioRemoveWhilePending(browser: Browser) {
  console.log("3. Typing in a period, then removing that period before the pause");
  const page = await mount(browser, ownDraft());
  const remove = page.getByRole("button", { name: "Remove Period 3" });
  await periodName(page, 2).click();
  await periodName(page, 2).fill("Doomed");
  await remove.click();
  await page.waitForTimeout(1300);
  const after = await stored(page);
  check("the period is gone from the saved draft", periodLabels(after?.payload).length === 2 && !periodLabels(after?.payload).includes("Doomed"), periodLabels(after?.payload));
  check("the last save is the removal - nothing restored the period afterwards", periodLabels((await saves(page)).at(-1)?.payload).length === 2);
  check("the indicator clears: \"All changes saved\"", (await indicator(page)) === "All changes saved");
  await page.close();
}

async function scenarioSwitchWhilePending(browser: Browser) {
  console.log("4. Typing in a period, then switching to a school schedule before the pause");
  const page = await mount(browser, ownDraft());
  await periodName(page, 0).click();
  await periodName(page, 0).fill("Switching");
  await page.getByRole("radio", { name: /Regular Day/ }).click();
  await page.getByRole("button", { name: "Change schedule" }).click();
  await page.waitForTimeout(1300);
  const after = await stored(page);
  check("the saved draft uses the school schedule", after?.payload.schedule?.mode === "shared" && after.payload.schedule.scheduleId === "s-regular", after?.payload.schedule);
  check("the typed period name did not come back", !JSON.stringify(after?.payload).includes("Switching"));
  check("the last save is the switch", (await saves(page)).at(-1)?.payload.schedule?.mode === "shared");
  check("the indicator clears: \"All changes saved\"", (await indicator(page)) === "All changes saved");
  await page.close();
}

async function scenarioConflictWhilePending(browser: Browser) {
  console.log("5. A stale-revision conflict arrives while text is pending; the teacher uses the saved version");
  const page = await mount(browser, ownDraft());
  await page.evaluate(() => {
    const w = window as unknown as { __repo: { delayMs: number; serverWrite(change: (p: SetupDraft) => SetupDraft): void } };
    w.__repo.delayMs = 450;
    // Another tab saves first: renames the schedule. Period 1 keeps its name.
    w.__repo.serverWrite((payload) => ({ ...payload, schedule: payload.schedule?.mode === "own" ? { ...payload.schedule, name: "Other Tab Name" } : payload.schedule }));
  });
  // A save in flight from this tab (it will come back stale-revision)...
  await page.getByLabel("Type").nth(1).selectOption("prep");
  // ...while the teacher types in another field.
  await periodName(page, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.type("XX");
  await page.getByRole("alertdialog").waitFor({ timeout: 3000 });
  await page.getByRole("button", { name: "Use the saved version" }).click();
  const savesAtChoice = (await saves(page)).length;
  await page.waitForTimeout(1500);
  const after = await stored(page);
  const laterSaves = (await saves(page)).slice(savesAtChoice);
  check("no save after the choice carries the discarded typing", laterSaves.every((s) => !JSON.stringify(s.payload).includes("Period 1XX")), laterSaves.map((s) => periodLabels(s.payload)));
  check("the stored draft is still the other tab's version", after?.payload.schedule?.mode === "own" && after.payload.schedule.name === "Other Tab Name" && periodLabels(after.payload)[0] === "Period 1", { name: after?.payload.schedule, labels: periodLabels(after?.payload) });
  check("the screen shows the saved version's period name", (await periodName(page, 0).inputValue()) === "Period 1", await periodName(page, 0).inputValue());
  check("the indicator clears: \"All changes saved\"", (await indicator(page)) === "All changes saved", await indicator(page));
  await page.close();
}

/** Starts a save that will come back stale (another tab wrote first), then types into `fieldIndex` while it is in flight. */
async function conflictWhileTyping(page: Page, otherTab: (payload: SetupDraft) => SetupDraft, fieldIndex: number, text: string) {
  await page.evaluate((change) => {
    const w = window as unknown as { __repo: { delayMs: number; serverWrite(change: (p: SetupDraft) => SetupDraft): void } };
    w.__repo.delayMs = 450;
    w.__repo.serverWrite(new Function("payload", `return (${change})(payload)`) as (p: SetupDraft) => SetupDraft);
  }, otherTab.toString());
  await page.getByLabel("Type").nth(1).selectOption("prep");
  await periodName(page, fieldIndex).click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await page.getByRole("alertdialog").waitFor({ timeout: 3000 });
}

async function scenarioConflictRemovesTypedPeriod(browser: Browser) {
  console.log("6. Conflict while typing in a period the saved version no longer has; use the saved version");
  const page = await mount(browser, ownDraft());
  await conflictWhileTyping(
    page,
    (payload) => (payload.schedule?.mode === "own" ? { ...payload, schedule: { ...payload.schedule, blocks: payload.schedule.blocks.filter((b) => b.id !== "b3") } } : payload),
    2,
    "Gone",
  );
  await page.getByRole("button", { name: "Use the saved version" }).click();
  const savesAtChoice = (await saves(page)).length;
  await page.waitForTimeout(1500);
  const after = await stored(page);
  check("the removed period does not come back", periodLabels(after?.payload).length === 2 && !JSON.stringify(after?.payload).includes("Gone"), periodLabels(after?.payload));
  check("nothing is saved after the choice", (await saves(page)).length === savesAtChoice);
  check("the screen shows two periods", (await page.getByLabel("Period name").count()) === 2);
  check("the indicator clears: \"All changes saved\"", (await indicator(page)) === "All changes saved", await indicator(page));
  await page.close();
}

async function scenarioConflictKeepMine(browser: Browser) {
  console.log("7. Conflict while typing; keep what's on this screen");
  const page = await mount(browser, ownDraft());
  await conflictWhileTyping(page, (payload) => ({ ...payload, lunchWave: "B" }), 0, "Kept");
  await page.getByRole("button", { name: "Keep what's on this screen" }).click();
  await page.waitForTimeout(1500);
  const after = await stored(page);
  check("the typed text is part of the version kept", periodLabels(after?.payload)[0] === "Period 1Kept", periodLabels(after?.payload));
  check("...along with the edit that was in flight", after?.payload.schedule?.mode === "own" && after.payload.schedule.blocks[1].kind === "prep");
  check("...replacing the other tab's version, by choice", after?.payload.lunchWave === "none");
  check("the indicator clears: \"All changes saved\"", (await indicator(page)) === "All changes saved", await indicator(page));
  await page.close();
}

/**
 * Safari (macOS and iPadOS) does not move focus to a button when it is
 * clicked, so the text field being typed in never blurs. A click dispatched
 * without a focus change reproduces that in Chromium.
 */
async function safariClick(page: Page, name: string) {
  await page.getByRole("button", { name }).dispatchEvent("click");
}

async function scenarioSafariRemoveWhilePending(browser: Browser) {
  console.log("8. Safari-style: typing in a period, then tapping Remove (the field never blurs)");
  const page = await mount(browser, ownDraft());
  await periodName(page, 2).click();
  await periodName(page, 2).fill("Doomed");
  await safariClick(page, "Remove Period 3");
  await page.waitForTimeout(1300);
  const after = await stored(page);
  check("the removed period stays removed", periodLabels(after?.payload).length === 2 && !periodLabels(after?.payload).includes("Doomed"), periodLabels(after?.payload));
  check("the indicator clears: \"All changes saved\"", (await indicator(page)) === "All changes saved", await indicator(page));
  await page.close();
}

async function scenarioSafariAddWhilePending(browser: Browser) {
  console.log("9. Safari-style: typing in a period, then tapping Add a period");
  const page = await mount(browser, ownDraft());
  await periodName(page, 0).click();
  await periodName(page, 0).fill("Homeroom");
  await safariClick(page, "Add a period");
  await page.waitForTimeout(1300);
  const after = await stored(page);
  check("both edits survive: the new period and the typed name", periodLabels(after?.payload).length === 4 && periodLabels(after?.payload)[0] === "Homeroom", periodLabels(after?.payload));
  check("the indicator clears: \"All changes saved\"", (await indicator(page)) === "All changes saved", await indicator(page));
  await page.close();
}

const lessonOf = async (page: Page) => (await stored(page))?.payload.firstLesson ?? null;
const completeCalls = (page: Page) => page.evaluate(() => (window as unknown as { __repo: { completeCalls: Array<{ operationId: string; answer: string }> } }).__repo.completeCalls);
const commits = (page: Page) => page.evaluate(() => (window as unknown as { __repo: { commits: Array<{ operationId: string; courses: number; classSections: number; lessons: number; payload: SetupDraft }> } }).__repo.commits);
const navigations = (page: Page) => page.evaluate(() => (window as unknown as { __repo: { navigations: string[] } }).__repo.navigations);

async function toLessonStep(page: Page) {
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Your first lesson", level: 1 }).waitFor({ timeout: 3000 });
}

async function scenarioLessonStep(browser: Browser) {
  console.log("10. Stage 1 → Stage 2: class, date, sample learning target, optional content");
  const page = await mount(browser, ownDraft());
  await toLessonStep(page);
  check("Continue moves to \"Your first lesson\" and saves that step", (await stored(page))?.payload.step === "first-lesson");
  check("focus moves to the new step's heading", await page.evaluate(() => document.activeElement?.tagName === "H1"));
  check("no lesson exists until the teacher edits one", (await lessonOf(page)) === null);
  check("the learning target starts empty - no sample until asked", (await page.getByRole("textbox", { name: "Learning target" }).inputValue()) === "");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(300);
  const issuesText = await page.getByRole("alert").filter({ hasText: "Before you continue" }).innerText();
  check("Continue with nothing filled in lists class, date and learning target", /class this lesson/.test(issuesText) && /date/.test(issuesText) && /learning target/.test(issuesText), issuesText);

  await page.getByLabel("Class", { exact: true }).selectOption({ label: "Geometry — Period 1" });
  await page.getByLabel("Lesson date").fill("2026-10-17");
  await page.waitForTimeout(200);
  const noCalendarNote = await page.locator("section[aria-labelledby=lesson-date-heading] [role=status]").innerText();
  check("without a school calendar, nothing is claimed about the day - just the date", noCalendarNote === "Saturday, October 17, 2026", noCalendarNote);
  await page.getByLabel("Lesson date").fill("2026-10-19");
  await page.getByRole("button", { name: "Use a sample learning target" }).click();
  await page.waitForTimeout(300);
  const sample = await page.getByRole("textbox", { name: "Learning target" }).inputValue();
  check("the sample is inserted only on request, naming the class's course", sample === "I can explain and use today's key idea in Geometry.", sample);
  check("...and the field is focused for editing", await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value?.startsWith("I can") === true));
  await page.keyboard.press("End");
  await page.keyboard.type(" Today: angles.");
  await page.getByText(/Add more \(optional\)/).click();
  await page.getByLabel("Add agenda item").first().fill("Warm-up");
  await page.getByRole("button", { name: "Add agenda item" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(500);
  const lesson = await lessonOf(page);
  check("the saved lesson has the class, date, edited target and agenda item", lesson?.classSectionId === "section-geo-1" && lesson.date === "2026-10-19" && lesson.learningTarget.endsWith("Today: angles.") && lesson.agendaItems[0]?.title === "Warm-up", lesson);
  await page.getByRole("heading", { name: "Review and start", level: 1 }).waitFor({ timeout: 3000 });
  check("Continue on a complete lesson opens the review - and nothing completes setup", (await completeCalls(page)).length === 0 && (await stored(page))?.payload.step === "review");
  check("the review shows the lesson as written", (await page.locator("main").innerText()).includes("Today: angles."));
  check("the indicator settles on \"All changes saved\"", (await indicator(page)) === "All changes saved");

  console.log("11. Edit, Back and Continue keep edits; reload resumes the saved step");
  await page.getByRole("button", { name: "Edit first lesson" }).click();
  await page.getByRole("heading", { name: "Your first lesson", level: 1 }).waitFor({ timeout: 3000 });
  await page.getByRole("textbox", { name: "Learning target" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("heading", { name: "Your teaching day", level: 1 }).waitFor({ timeout: 3000 });
  await page.getByText("All changes saved").waitFor({ timeout: 3000 });
  const backDraft = (await stored(page))?.payload;
  check("Back right after typing keeps the typed text", backDraft?.firstLesson?.learningTarget.endsWith("angles.!") === true, backDraft?.firstLesson?.learningTarget);
  check("Back saves the teaching-day step", backDraft?.step === "teaching-day");
  await toLessonStep(page);
  check("Continue returns to the lesson with everything still there", (await page.getByRole("textbox", { name: "Learning target" }).inputValue()).endsWith("angles.!") && (await page.getByLabel("Lesson date").inputValue()) === "2026-10-19");
  await page.getByText("All changes saved").waitFor({ timeout: 3000 });
  const saved = (await stored(page))?.payload as SetupDraft;
  await page.close();
  const reloaded = await mount(browser, saved);
  check("a reload opens on the saved step", await reloaded.getByRole("heading", { name: "Your first lesson", level: 1 }).isVisible());
  check("...with the lesson as saved", (await reloaded.getByRole("textbox", { name: "Learning target" }).inputValue()).endsWith("angles.!"));
  check("...and reads \"All changes saved\"", (await indicator(reloaded)) === "All changes saved");
  check("no completion was ever requested", (await completeCalls(reloaded)).length === 0);
  await reloaded.close();
}

async function scenarioLessonDateWithCalendar(browser: Browser) {
  console.log("14. With the school's calendar: weekends and no-school days are described, never blocked");
  const draft = ownDraft();
  draft.step = "first-lesson";
  const page = await mount(browser, draft, CALENDAR);
  const note = () => page.locator("section[aria-labelledby=lesson-date-heading] [role=status]").innerText();
  await page.getByLabel("Lesson date").fill("2026-10-23");
  await page.waitForTimeout(200);
  check("a calendar no-school day says so, with its title", /no school on Friday, October 23, 2026 \(Professional Development Day\)\. You can still plan for it\./.test(await note()), await note());
  await page.getByLabel("Lesson date").fill("2026-10-24");
  await page.waitForTimeout(200);
  check("a weekend says so", /Saturday, October 24, 2026 is a weekend/.test(await note()), await note());
  await page.getByLabel("Lesson date").fill("2027-07-01");
  await page.waitForTimeout(200);
  check("a date after the school year says so", /outside your school year/.test(await note()), await note());
  check("the date is still saved - the screen never blocks a date", (await lessonOf(page))?.date === "2027-07-01");
  await page.close();
}

async function scenarioTodayAcrossMidnight(browser: Browser) {
  console.log("15. A page left open overnight: \"Today\" follows the school's clock");
  const draft = ownDraft();
  draft.step = "first-lesson";
  const page = await browser.newPage();
  // 11:50 pm on Friday, October 16 in Detroit (the schedule's time zone).
  await page.clock.install({ time: new Date("2026-10-17T03:50:00Z") });
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.evaluate((value) => {
    (window as unknown as { __HARNESS: unknown }).__HARNESS = value;
  }, props(draft));
  await page.addScriptTag({ content: bundled });
  await page.getByRole("heading", { level: 1 }).waitFor();
  const todayButton = page.getByRole("button", { name: /^Today \(/ });
  check("before midnight it offers Friday, October 16", (await todayButton.innerText()) === "Today (Friday, October 16, 2026)", await todayButton.innerText());
  await page.clock.runFor(20 * 60 * 1000); // to 12:10 am Saturday
  await page.waitForTimeout(100);
  check("after midnight it offers Saturday, October 17", (await todayButton.innerText()) === "Today (Saturday, October 17, 2026)", await todayButton.innerText());
  await todayButton.click();
  await page.clock.runFor(1000);
  await page.waitForTimeout(200);
  check("and choosing it saves October 17", (await lessonOf(page))?.date === "2026-10-17", await lessonOf(page));
  await page.close();
}

async function scenarioLessonClassRemoved(browser: Browser) {
  console.log("12. The lesson's class goes away on step 1: the lesson keeps its content and asks for a class again");
  const draft = ownDraft();
  draft.step = "first-lesson";
  draft.firstLesson = { id: "lesson-1", date: "2026-10-19", classSectionId: "section-geo-1", learningTarget: "I can measure angles.", agendaItems: [], resources: [], announcements: [] };
  const page = await mount(browser, draft);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("heading", { name: "Your teaching day", level: 1 }).waitFor();
  await page.getByLabel("Course for Period 1").selectOption({ label: "No class this period" });
  await page.waitForTimeout(300);
  const lesson = await lessonOf(page);
  check("the lesson's class is cleared, its target and date kept", lesson?.classSectionId === "" && lesson.learningTarget === "I can measure angles." && lesson.date === "2026-10-19", lesson);
  await page.close();
}

async function scenarioConflictShowsPeriodCount(browser: Browser) {
  console.log("13. A conflict summary shows each version's period count");
  const page = await mount(browser, ownDraft());
  await conflictWhileTyping(
    page,
    (payload) =>
      payload.schedule?.mode === "own"
        ? { ...payload, schedule: { ...payload.schedule, blocks: [...payload.schedule.blocks, { id: "b4", label: "Period 4", kind: "instructional", startTime: "10:45", endTime: "11:35", classSectionId: null }] } }
        : payload,
    0,
    "x",
  );
  const text = await page.getByRole("alertdialog").innerText();
  check("this screen: 3 periods; saved version: 4 periods", /On this screen[\s\S]*3 periods[\s\S]*Saved version[\s\S]*4 periods/.test(text), text);
  await page.close();
}

// --- Stage 3: review and completion ---------------------------------------------------

/** A draft ready to complete: Geometry in Period 1 and a first lesson, on the review step. */
function reviewDraft(): SetupDraft {
  return {
    ...ownDraft(),
    step: "review",
    firstLesson: {
      id: "lesson-1",
      date: "2026-10-19",
      classSectionId: "section-geo-1",
      learningTarget: "I can measure angles.",
      agendaItems: [{ id: "a1", title: "Warm-up", isCompleted: false, sortOrder: 0 }],
      resources: [],
      announcements: [],
    },
  };
}

/** The same, on the school's shared schedule (Geometry in 1st Hour). */
function sharedReviewDraft(): SetupDraft {
  return {
    ...reviewDraft(),
    schedule: { mode: "shared", scheduleId: SCHOOL.id, expectedBlocks: snapshotSharedBlocks(SCHOOL), assignments: [{ id: "as-1", blockId: "p1", classSectionId: "section-geo-1" }] },
  };
}

const startButton = (page: Page) => page.getByRole("button", { name: /Start my classroom|Try again|Starting your classroom/ });
const setRepo = (page: Page, values: Record<string, unknown>) =>
  page.evaluate((v) => Object.assign((window as unknown as { __repo: object }).__repo, v), values);
async function waitFor(page: Page, predicate: () => Promise<boolean>, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await page.waitForTimeout(25);
  }
  return false;
}

async function scenarioReviewSummaryAndEdit(browser: Browser) {
  console.log("16. Review: summary, classroom preview, and Edit/Continue with pending text");
  const page = await mount(browser, reviewDraft());
  const main = page.locator("main");
  check("a saved review step reopens on \"Review and start\"", await page.getByRole("heading", { name: "Review and start", level: 1 }).isVisible());
  const text = await main.innerText();
  check("the summary shows the schedule, each period's class, and the lesson", ["My Day", "Period 1", "Geometry — Period 1", "Period 2", "No class", "I can measure angles.", "Warm-up", "Monday, October 19, 2026"].every((part) => text.includes(part)), text);
  const preview = page.getByRole("region", { name: "Your classroom display" });
  await preview.getByText("I can measure angles.").first().waitFor({ state: "attached", timeout: 3000 });
  check("the classroom preview renders the lesson through the Present components", (await preview.innerHTML()).includes("I can measure angles."));
  check("...and is inert, out of the tab order", (await preview.locator("[inert]").count()) === 1);
  const previewHtml = await preview.innerHTML();
  check("the preview names the lesson's period, not \"No period selected\"", previewHtml.includes("Period 1") && !/No Period Selected/i.test(previewHtml), previewHtml.slice(0, 400));
  check("...with no period picker when the class meets once that day", (await preview.locator("select").count()) === 0);
  check("rendering the review saved nothing and completed nothing", (await saves(page)).length === 0 && (await completeCalls(page)).length === 0);

  await page.getByRole("button", { name: "Edit teaching day" }).click();
  await page.getByRole("heading", { name: "Your teaching day", level: 1 }).waitFor({ timeout: 3000 });
  check("Edit teaching day opens step 1", true);
  await periodName(page, 1).fill("Planning");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Your first lesson", level: 1 }).waitFor({ timeout: 3000 });
  const target = page.getByRole("textbox", { name: "Learning target" });
  await target.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Today: triangles.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Review and start", level: 1 }).waitFor({ timeout: 3000 });
  const after = await main.innerText();
  check("Continue before the pause carries both pending edits to the review", after.includes("Planning") && after.includes("I can measure angles. Today: triangles."), after);
  await page.getByText("All changes saved").waitFor({ timeout: 3000 });
  const savedDraft = (await stored(page))?.payload;
  check("...and saves them, on the review step", savedDraft?.step === "review" && periodLabels(savedDraft)[1] === "Planning" && savedDraft.firstLesson?.learningTarget.endsWith("triangles.") === true);
  await page.getByRole("button", { name: "Edit first lesson" }).click();
  await page.getByRole("heading", { name: "Your first lesson", level: 1 }).waitFor({ timeout: 3000 });
  check("Edit first lesson opens step 2 with the lesson intact", (await target.inputValue()).endsWith("triangles.") && (await page.getByLabel("Lesson date").inputValue()) === "2026-10-19");
  await target.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("heading", { name: "Your teaching day", level: 1 }).waitFor({ timeout: 3000 });
  await page.getByText("All changes saved").waitFor({ timeout: 3000 });
  check("Back right after typing keeps the text", (await stored(page))?.payload.firstLesson?.learningTarget.endsWith("triangles.!") === true);
  check("no completion was requested by any of it", (await completeCalls(page)).length === 0);
  await page.close();
}

async function scenarioFinishWithPendingTextAndDuplicateClicks(browser: Browser) {
  console.log("17. Start my classroom: pending text saved first, one commit for many clicks, then /present");
  const page = await mount(browser, { ...reviewDraft(), step: "first-lesson" });
  await setRepo(page, { completeDelayMs: 400 });
  const target = page.getByRole("textbox", { name: "Learning target" });
  await target.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Last edit.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Review and start", level: 1 }).waitFor({ timeout: 3000 });
  check("nothing operational exists before Start", (await commits(page)).length === 0);
  const start = startButton(page);
  await start.click();
  await start.dispatchEvent("click");
  await start.dispatchEvent("click");
  await page.getByText("Creating your classes, schedule and first lesson").waitFor({ timeout: 3000 });
  check("while completing: a clear status, a busy button, and the steps locked", (await start.innerText()) === "Starting your classroom…" && (await start.isDisabled()) && (await page.getByRole("button", { name: "Back" }).isDisabled()));
  await start.dispatchEvent("click");
  check("it finishes", await waitFor(page, async () => (await navigations(page)).length > 0));
  const done = await commits(page);
  check("three clicks and a click while busy: complete_setup was called once and committed once", (await completeCalls(page)).length === 1 && done.length === 1, await completeCalls(page));
  check("the commit includes the text typed just before Continue", done[0]?.payload.firstLesson?.learningTarget === "I can measure angles. Last edit.", done[0]?.payload.firstLesson);
  check("one course, one class, one lesson", done[0]?.courses === 1 && done[0].classSections === 1 && done[0].lessons === 1);
  check("success navigates to /present, once", deepEqualJson(await navigations(page), ["/present"]));
  check("the screen says the classroom is ready, with a link to /present", (await page.getByRole("link", { name: "Open your classroom display" }).getAttribute("href")) === "/present");
  check("no unsaved-work warning blocks leaving", await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return !event.defaultPrevented;
  }));
  await page.close();
}

const deepEqualJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function scenarioFailedCompletionAndRetry(browser: Browser) {
  console.log("18. A completion that fails before committing can be retried, with the same operation id");
  const page = await mount(browser, reviewDraft());
  await setRepo(page, { completeMode: "fail-before-commit", completeDelayMs: 30 });
  await startButton(page).click();
  await page.getByText("We couldn't confirm that setup finished.").waitFor({ timeout: 3000 });
  check("failure: a plain message, no raw error text, and a Try again button", !(await page.locator("main").innerText()).includes("TypeError") && (await startButton(page).innerText()) === "Try again");
  check("...and nothing was committed or navigated", (await commits(page)).length === 0 && (await navigations(page)).length === 0);
  check("the review stays editable", !(await page.getByRole("button", { name: "Edit first lesson" }).isDisabled()));
  await setRepo(page, { completeMode: "ok" });
  await startButton(page).click();
  check("Try again finishes", await waitFor(page, async () => (await navigations(page)).length === 1));
  const calls = await completeCalls(page);
  check("both attempts used the same operation id; one commit", calls.length === 2 && calls[0].operationId === calls[1].operationId && (await commits(page)).length === 1, calls);
  await page.close();
}

async function scenarioLostSuccessResponse(browser: Browser) {
  console.log("19. A lost answer after the server committed: Try again confirms it, without a second commit");
  const page = await mount(browser, reviewDraft());
  await setRepo(page, { completeMode: "lose-answer-after-commit", completeDelayMs: 30 });
  await startButton(page).click();
  await page.getByText("We couldn't confirm that setup finished.").waitFor({ timeout: 3000 });
  check("the server committed, but the screen can't know: unconfirmed, no navigation", (await commits(page)).length === 1 && (await navigations(page)).length === 0);
  await startButton(page).click();
  check("Try again finishes", await waitFor(page, async () => (await navigations(page)).length === 1));
  const calls = await completeCalls(page);
  check("the retry was answered as a replay of the same operation", calls.length === 2 && calls[1].answer === "replayed" && calls[0].operationId === calls[1].operationId, calls);
  check("still exactly one commit", (await commits(page)).length === 1);
  await page.close();

  console.log("20. After completion, a stale tab or reloaded draft cannot complete or change anything");
  const stale = await mount(browser, reviewDraft());
  await setRepo(stale, {
    completion: { operationId: "op-other-tab", completedAt: new Date().toISOString(), scheduleMode: "own", activeBellScheduleId: "schedule-own", courseIds: [], classSectionIds: [], lessonId: "lesson-1" },
    stored: null,
  });
  await startButton(stale).click();
  check("Start on a tab whose setup was finished elsewhere goes to /present", await waitFor(stale, async () => (await navigations(stale)).length === 1));
  check("...with no new commit", (await commits(stale)).length === 0 && (await completeCalls(stale))[0]?.answer === "already-completed");
  await stale.close();
  const editing = await mount(browser, reviewDraft());
  await setRepo(editing, { completion: { operationId: "op-1", completedAt: new Date().toISOString(), scheduleMode: "own", activeBellScheduleId: "schedule-own", courseIds: [], classSectionIds: [], lessonId: "lesson-1" }, stored: null });
  await editing.getByRole("button", { name: "Edit first lesson" }).click();
  await editing.getByRole("heading", { name: "Your classroom is ready" }).waitFor({ timeout: 3000 });
  check("an edit's save learns setup is complete and shows the finished state, not the form", (await editing.getByRole("textbox").count()) === 0);
  check("...without committing or navigating by itself", (await commits(editing)).length === 0 && (await navigations(editing)).length === 0);
  await editing.close();
}

async function scenarioStaleRevisionAtCompletion(browser: Browser) {
  console.log("21. Stale revision at completion: both versions, explicit choice, then one commit");
  const page = await mount(browser, reviewDraft());
  await page.evaluate(() => (window as unknown as { __repo: { serverWrite(c: (p: SetupDraft) => SetupDraft): void } }).__repo.serverWrite((p) => ({ ...p, firstLesson: p.firstLesson && { ...p.firstLesson, learningTarget: "I can bisect an angle." } })));
  await startButton(page).click();
  await page.getByRole("heading", { name: "This setup was changed in another tab or device" }).waitFor({ timeout: 3000 });
  const panel = await page.locator("main").innerText();
  check("both versions are shown, with their lessons", panel.includes("I can bisect an angle.") && panel.includes("I can measure angles."), panel);
  check("nothing committed", (await commits(page)).length === 0);
  await page.getByRole("button", { name: "Use the saved version" }).click();
  check("the review now shows the saved version", await waitFor(page, async () => (await page.locator("main").innerText()).includes("I can bisect an angle.")));
  await startButton(page).click();
  check("Start then commits that version, once", await waitFor(page, async () => (await commits(page)).length === 1) && (await commits(page))[0].payload.firstLesson?.learningTarget === "I can bisect an angle.");
  await page.close();
}

async function scenarioSharedScheduleChanged(browser: Browser) {
  console.log("22. The school's schedule changed: refresh it, keep what fits and the lesson, and review again");
  const page = await mount(browser, sharedReviewDraft());
  const updated: BellSchedule = { ...SCHOOL, blocks: [{ ...SCHOOL.blocks[0], endTime: "08:55" }, { ...SCHOOL.blocks[1], startTime: "09:00" }] };
  await setRepo(page, {
    completeMode: "shared-schedule-changed",
    nextReference: { schoolSchedules: [updated], schoolCourses: [], schoolCalendar: null, baseData: baseAppData({ schedules: [updated], courses: [], calendar: null }) },
  });
  await startButton(page).click();
  await page.getByRole("heading", { name: "Your school updated its schedule" }).waitFor({ timeout: 3000 });
  check("nothing committed", (await commits(page)).length === 0);
  await page.getByRole("button", { name: "Get the latest schedule and review" }).click();
  await page.getByRole("heading", { name: "Your teaching day", level: 1 }).waitFor({ timeout: 3000 });
  await page.getByText("All changes saved").waitFor({ timeout: 3000 });
  const refreshed = (await stored(page))?.payload;
  const shared = refreshed?.schedule?.mode === "shared" ? refreshed.schedule : null;
  check("the draft now expects the updated periods, and is back on step 1 for review", refreshed?.step === "teaching-day" && shared?.expectedBlocks[0]?.endTime === "08:55", shared?.expectedBlocks);
  check("Geometry stays in 1st Hour, and the lesson is untouched", shared?.assignments[0]?.blockId === "p1" && refreshed?.firstLesson?.learningTarget === "I can measure angles.");
  check("the updated times are on screen", (await page.locator("main").innerText()).includes("8:55"));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Your first lesson", level: 1 }).waitFor({ timeout: 3000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("heading", { name: "Review and start", level: 1 }).waitFor({ timeout: 3000 });
  await startButton(page).click();
  check("after review, Start commits once against the updated schedule", await waitFor(page, async () => (await commits(page)).length === 1));
  await page.close();
}

async function scenarioPreferencesChanged(browser: Browser) {
  console.log("23. Schedule preferences changed elsewhere: shown, adopted on request, never overwritten");
  const page = await mount(browser, reviewDraft());
  await setRepo(page, { completeMode: "preferences-changed", currentPreferences: { activeBellScheduleId: SCHOOL.id, lunchWave: "B" } });
  await startButton(page).click();
  await page.getByRole("heading", { name: "Your schedule settings changed in another window" }).waitFor({ timeout: 3000 });
  const panel = await page.locator("main").innerText();
  check("the current choices are shown: the schedule and the lunch wave", panel.includes("Regular Day") && panel.includes("B Lunch"), panel);
  check("...with the consequence for placed classes, and the lesson kept", panel.includes("place your classes in its periods again") && panel.includes("Your first lesson is kept"));
  check("there is no way to insist on the older choice", (await page.getByRole("button", { name: /Keep what's on this screen/ }).count()) === 0);
  check("nothing committed", (await commits(page)).length === 0);
  await page.getByRole("button", { name: "Use these settings and continue" }).click();
  await page.getByRole("heading", { name: "Your teaching day", level: 1 }).waitFor({ timeout: 3000 });
  await page.getByText("All changes saved").waitFor({ timeout: 3000 });
  const adopted = (await stored(page))?.payload;
  check("the draft adopts Regular Day and B Lunch", adopted?.schedule?.mode === "shared" && adopted.schedule.scheduleId === SCHOOL.id && adopted.lunchWave === "B");
  check("the lesson's date and target survive; only its class must be chosen again", adopted?.firstLesson?.learningTarget === "I can measure angles." && adopted.firstLesson.date === "2026-10-19");
  check("nothing committed during recovery", (await commits(page)).length === 0);
  await page.close();
}

async function scenarioNoLongerEligible(browser: Browser) {
  console.log("24. No longer eligible at completion: back to the existing app, nothing written");
  const page = await mount(browser, reviewDraft());
  await setRepo(page, { completeMode: "no-longer-eligible" });
  await startButton(page).click();
  await page.getByRole("heading", { name: "Your account is already set up" }).waitFor({ timeout: 3000 });
  check("a link back to the existing app", (await page.getByRole("link", { name: "Go to Falcon Deck" }).getAttribute("href")) === "/setup");
  check("no form, no commit, no navigation to /present", (await page.getByRole("textbox").count()) === 0 && (await commits(page)).length === 0 && (await navigations(page)).length === 0);
  await page.close();
}

async function main() {
  bundled = await bundle();
  const browser = await chromium.launch();
  try {
    await scenarioEnterBeforeDebounce(browser);
    await scenarioContinueBeforeDebounce(browser);
    await scenarioRemoveWhilePending(browser);
    await scenarioSwitchWhilePending(browser);
    await scenarioConflictWhilePending(browser);
    await scenarioConflictRemovesTypedPeriod(browser);
    await scenarioConflictKeepMine(browser);
    await scenarioSafariRemoveWhilePending(browser);
    await scenarioSafariAddWhilePending(browser);
    await scenarioLessonStep(browser);
    await scenarioLessonDateWithCalendar(browser);
    await scenarioTodayAcrossMidnight(browser);
    await scenarioLessonClassRemoved(browser);
    await scenarioConflictShowsPeriodCount(browser);
    await scenarioReviewSummaryAndEdit(browser);
    await scenarioFinishWithPendingTextAndDuplicateClicks(browser);
    await scenarioFailedCompletionAndRetry(browser);
    await scenarioLostSuccessResponse(browser);
    await scenarioStaleRevisionAtCompletion(browser);
    await scenarioSharedScheduleChanged(browser);
    await scenarioPreferencesChanged(browser);
    await scenarioNoLongerEligible(browser);
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
