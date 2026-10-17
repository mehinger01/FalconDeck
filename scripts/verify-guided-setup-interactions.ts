/**
 * Real-browser interaction checks for guided setup: the actual GuidedSetup
 * component, bundled with esbuild and driven by Playwright's Chromium with
 * an in-memory repository (scripts/support/guidedSetupHarness.tsx). No Next
 * server, no network, no database. Focuses on what unit tests cannot see:
 * typed text that has not been committed yet (DraftTextInput's ~700 ms
 * debounce) racing Enter, Continue, removals, schedule switches and
 * conflicts.
 *
 *   npm run verify:guided-setup-interactions
 */
import { build } from "esbuild";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { GuidedSetupProps } from "@/components/guided/GuidedSetup";
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
const completeCalls = (page: Page) => page.evaluate(() => (window as unknown as { __repo: { completeCalls: number } }).__repo.completeCalls);

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
  check("Continue on a complete lesson says it is saved - and nothing completes setup", /first lesson is saved/.test(await page.locator("footer").innerText()) && (await completeCalls(page)) === 0);
  check("the indicator settles on \"All changes saved\"", (await indicator(page)) === "All changes saved");

  console.log("11. Back and Continue keep edits; reload resumes the saved step");
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
  check("no completion was ever requested", (await completeCalls(reloaded)) === 0);
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
    await scenarioLessonClassRemoved(browser);
    await scenarioConflictShowsPeriodCount(browser);
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
