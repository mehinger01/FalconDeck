/**
 * Standalone verification for Stage D of the teacher-transition-content
 * initiative: the editing UX for DailyLesson.warmup and TransitionOverride
 * (materials/warmup tri-state + note), added to the existing Lessons
 * editor. Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:transition-content-stage-d
 *
 * Architecture note (see the Stage D report's Section A/audit): the real
 * Lessons editor has no draft/Save/Cancel model anywhere - every field
 * (Materials, Learning Target, agenda items, Warm-Up, and now the
 * Transition controls) dispatches directly on change, exactly like every
 * other field on that page. So "opening the editor causes zero mutation"
 * and "cancel discards unsaved changes" are proven here as: the editor
 * components never dispatch outside an explicit onChange/onClick handler
 * (source-scanned, Part 8) - there is no hidden effect-driven write, and
 * nothing is ever "pending" to cancel in the first place.
 *
 * Autosave semantics, precisely: each user edit dispatches immediately,
 * and each resulting AppData change may trigger its own
 * `repository.save()` (AppDataProvider's effect on `[data, ...]`). Warm-up
 * and transition-override edits are logically coordinated through the same
 * AppData/store/repository architecture, but this is NOT a database
 * transaction and NOT a guarantee that two edits share one reducer
 * dispatch or one repository save. Part 6 below proves CONSISTENCY of the
 * final state after two separate, sequential dispatches - never
 * atomicity of the two dispatches themselves.
 *
 * Split into parts, pure-first:
 *   1. Mode/value normalization helpers (no reducer, no components).
 *   2. SET_TRANSITION_OVERRIDE reducer behavior - sparse rows, id
 *      stability, independence of materials/warmup/note.
 *   3. DailyLesson.warmup via the lesson action slice.
 *   4. No-lesson-required transition overrides.
 *   5. Live default-preview data (no staleness).
 *   6. applyDiff write isolation (recording fake client, same pattern as
 *      scripts/verify-transition-content-stage-b.ts).
 *   7. Zero-mutation-on-render source scan.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appDataReducer } from "@/lib/store/reducer";
import { createLessonActions } from "@/lib/store/lessonActions";
import { createTransitionOverrideActions } from "@/lib/store/transitionOverrideActions";
import {
  getTransitionOverrideMode,
  isFullyDefaultTransitionOverride,
  resolveCustomizeSeed,
} from "@/lib/data/transitionOverrideMode";
import { findLessonForSection } from "@/lib/data/lessons";
import { applyDiff } from "@/lib/data/supabaseDataRepository";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import type { Database } from "@/lib/data/supabase.types";
import type { AppData } from "@/lib/data/types";
import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
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

const DATE = "2026-09-29";
const SECTION_A = "section-geometry-2";

function baseAppData(): AppData {
  return {
    courses: [{ id: "course-geometry", name: "Geometry" }],
    classSections: [{ id: SECTION_A, courseId: "course-geometry", name: "Geometry - Period 2" }],
    schedules: [],
    lessons: [],
    classPresentationSettings: [],
    classroomExperienceSettings: DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
    libraryResources: [],
    teacherSchedulePreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
    schoolCalendar: null,
    teacherPeriodAssignments: [],
    transitionOverrides: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Mode/value normalization helpers
// ---------------------------------------------------------------------------

console.log("1. getTransitionOverrideMode: undefined/null/string map to the three UI modes");
check("undefined -> default", getTransitionOverrideMode(undefined) === "default");
check("null -> hide", getTransitionOverrideMode(null) === "hide");
check("a string -> customize", getTransitionOverrideMode("Workbook") === "customize");
check("an EMPTY string still -> customize (not default, not hide)", getTransitionOverrideMode("") === "customize");

console.log("\n2. isFullyDefaultTransitionOverride: the exact sparse-row predicate");
check(
  "all fields at default -> true",
  isFullyDefaultTransitionOverride({ materialsOverride: undefined, warmupOverride: undefined, note: undefined }),
);
check(
  "a blank/whitespace-only note still counts as default",
  isFullyDefaultTransitionOverride({ materialsOverride: undefined, warmupOverride: undefined, note: "   " }),
);
check(
  "a real materials override -> not default",
  !isFullyDefaultTransitionOverride({ materialsOverride: "text", warmupOverride: undefined, note: undefined }),
);
check(
  "an explicit hide (null) -> not default",
  !isFullyDefaultTransitionOverride({ materialsOverride: null, warmupOverride: undefined, note: undefined }),
);
check(
  "a real note -> not default",
  !isFullyDefaultTransitionOverride({ materialsOverride: undefined, warmupOverride: undefined, note: "Reminder" }),
);

console.log("\n2b. resolveCustomizeSeed: the exact session-cache-restore rule behind onSelectCustom");
check("A. no session cache yet -> seeds from the lesson default", resolveCustomizeSeed(null, "Workbook") === "Workbook");
check(
  "D. a session cache exists -> it wins, the lesson default is ignored entirely",
  resolveCustomizeSeed("Bring textbook and calculator", "Workbook") === "Bring textbook and calculator",
);
check(
  "an intentionally-cleared cache (explicit '') is NOT the same as 'never customized' - it must NOT fall through to the lesson default",
  resolveCustomizeSeed("", "Workbook") === "",
);
check("no cache and no lesson default -> blank, never undefined/null leaking through", resolveCustomizeSeed(null, undefined) === "");

// ---------------------------------------------------------------------------
// 2. SET_TRANSITION_OVERRIDE reducer behavior
// ---------------------------------------------------------------------------

console.log("\n3-4. Default mode on a fresh state creates NO row; hide/customize do");
{
  let state = baseAppData();
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });

  actions.setTransitionMaterialsDefault(DATE, SECTION_A);
  check("4. explicitly choosing Default on a fresh state creates no row", state.transitionOverrides.length === 0);

  actions.setTransitionMaterialsCustom(DATE, SECTION_A, "Workbook, calculator");
  check("5. customize materials -> a string value", state.transitionOverrides[0]?.materialsOverride === "Workbook, calculator");
  check("customize materials creates exactly one row", state.transitionOverrides.length === 1);

  const idAfterCreate = state.transitionOverrides[0].id;
  actions.setTransitionMaterialsHidden(DATE, SECTION_A);
  check("6. hide materials -> null", state.transitionOverrides[0]?.materialsOverride === null);
  check("14. the row's id stayed stable across the customize -> hide edit", state.transitionOverrides[0].id === idAfterCreate);
}

console.log("\n7-9. Warm-up mode: default / customize / hide, independent of materials");
{
  let state = baseAppData();
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });

  actions.setTransitionMaterialsCustom(DATE, SECTION_A, "Custom materials");
  actions.setTransitionWarmupDefault(DATE, SECTION_A);
  check("7. default warmup mode -> undefined, materials untouched", state.transitionOverrides[0]?.warmupOverride === undefined && state.transitionOverrides[0]?.materialsOverride === "Custom materials");

  actions.setTransitionWarmupCustom(DATE, SECTION_A, "1. Solve for x");
  check("8. customize warmup -> a string value", state.transitionOverrides[0]?.warmupOverride === "1. Solve for x");
  check("materials is still untouched by the warmup edit", state.transitionOverrides[0]?.materialsOverride === "Custom materials");

  actions.setTransitionWarmupHidden(DATE, SECTION_A);
  check("9. hide warmup -> null", state.transitionOverrides[0]?.warmupOverride === null);
  check("still exactly one row for this (date, classSectionId)", state.transitionOverrides.length === 1);
}

console.log("\n10-11. Note saves; a blank note removes it (and the whole row, if nothing else is set)");
{
  let state = baseAppData();
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });

  actions.setTransitionNote(DATE, SECTION_A, "Bring your planner.");
  check("10. note saves", state.transitionOverrides[0]?.note === "Bring your planner.");

  actions.setTransitionNote(DATE, SECTION_A, "   ");
  check("11. a whitespace-only note normalizes to absent, deleting the now-fully-default row", state.transitionOverrides.length === 0);
}

console.log("\n12-13. Full sparse-row lifecycle: one field at a time added, then removed one at a time, same row throughout");
{
  let state = baseAppData();
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });

  check("start: zero overrides", state.transitionOverrides.length === 0);

  actions.setTransitionMaterialsCustom(DATE, SECTION_A, "Bring calculator");
  check("Customize Materials -> exactly 1 row", state.transitionOverrides.length === 1);
  const rowId = state.transitionOverrides[0].id;

  actions.setTransitionWarmupHidden(DATE, SECTION_A);
  check("Warm-Up = Hide -> still exactly 1 row, same id", state.transitionOverrides.length === 1 && state.transitionOverrides[0].id === rowId);

  actions.setTransitionNote(DATE, SECTION_A, "Quiz today");
  check("Note = 'Quiz today' -> still exactly 1 row, same id", state.transitionOverrides.length === 1 && state.transitionOverrides[0].id === rowId);

  actions.setTransitionMaterialsDefault(DATE, SECTION_A);
  check(
    "Materials -> Default: row REMAINS (Warm-Up=Hide and Note are still overridden), same id",
    state.transitionOverrides.length === 1 && state.transitionOverrides[0].id === rowId && state.transitionOverrides[0].materialsOverride === undefined,
  );

  actions.setTransitionWarmupDefault(DATE, SECTION_A);
  check(
    "Warm-Up -> Default: row REMAINS (Note is still set), same id",
    state.transitionOverrides.length === 1 && state.transitionOverrides[0].id === rowId && state.transitionOverrides[0].warmupOverride === undefined,
  );

  actions.setTransitionNote(DATE, SECTION_A, "");
  check("13. Note -> blank, the last non-default field: row count returns to 0", state.transitionOverrides.length === 0);
}

console.log("\nExtra: Default -> Customize -> Default with no other field ever touched also returns to zero rows");
{
  let state = baseAppData();
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });
  actions.setTransitionMaterialsCustom(DATE, SECTION_A, "Temporary override");
  check("a real override now exists", state.transitionOverrides.length === 1);
  actions.setTransitionMaterialsDefault(DATE, SECTION_A);
  check("reverting the only non-default field back to Default deletes the row", state.transitionOverrides.length === 0);
}

console.log("\n15. A brand-new override uses the freshly-generated id; a second field edit on the SAME row does not mint a second id");
{
  let state = baseAppData();
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });
  actions.setTransitionMaterialsCustom(DATE, SECTION_A, "First");
  const firstId = state.transitionOverrides[0].id;
  check("15. the new row has a generated id", typeof firstId === "string" && firstId.length > 0);
  actions.setTransitionNote(DATE, SECTION_A, "Second field, same row");
  check("the row count is still exactly 1 (no duplicate row from the second dispatch)", state.transitionOverrides.length === 1);
  check("the id is unchanged", state.transitionOverrides[0].id === firstId);
}

console.log("\nExtra: two different (date, classSectionId) pairs never collide");
{
  let state = baseAppData();
  state = { ...state, classSections: [...state.classSections, { id: "section-b", courseId: "course-geometry", name: "Geometry - Period 5" }] };
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });
  actions.setTransitionMaterialsCustom(DATE, SECTION_A, "Section A materials");
  actions.setTransitionMaterialsCustom(DATE, "section-b", "Section B materials");
  check("two independent rows exist", state.transitionOverrides.length === 2);
  check("each keeps its own value", state.transitionOverrides.find((o) => o.classSectionId === SECTION_A)?.materialsOverride === "Section A materials" && state.transitionOverrides.find((o) => o.classSectionId === "section-b")?.materialsOverride === "Section B materials");
}

// ---------------------------------------------------------------------------
// 3. DailyLesson.warmup via the lesson action slice
// ---------------------------------------------------------------------------

console.log("\n1-3 (lesson side). Warm-up field loads/saves DailyLesson.warmup, blank normalizes like Materials");
{
  let state = baseAppData();
  const actions = createLessonActions(state, (action) => {
    state = appDataReducer(state, action);
  });

  check("1. no lesson yet -> warmup reads as absent (undefined)", findLessonForSection(state.lessons, DATE, SECTION_A)?.warmup === undefined);

  actions.updateWarmup(DATE, SECTION_A, "1. Solve for x. 2. Simplify.");
  const afterSave = findLessonForSection(state.lessons, DATE, SECTION_A);
  check("2. warm-up field saves to DailyLesson.warmup", afterSave?.warmup === "1. Solve for x. 2. Simplify.");
  check("2b. saving warmup on a lesson-less cell creates exactly one lesson (getOrInitLesson), same as Materials", state.lessons.length === 1);

  const actionsAfter = createLessonActions(state, (action) => {
    state = appDataReducer(state, action);
  });
  actionsAfter.updateWarmup(DATE, SECTION_A, "");
  const afterBlank = findLessonForSection(state.lessons, DATE, SECTION_A);
  check(
    "3. a blank warmup normalizes exactly like Materials does - stored as '', not specially coerced (ClassroomView/TransitionScreen already treat blank as 'nothing to show')",
    afterBlank?.warmup === "",
  );
}

// ---------------------------------------------------------------------------
// 4. No-lesson-required transition overrides
// ---------------------------------------------------------------------------

console.log("\n21-22. A transition note alone, with zero lessons in AppData, round-trips correctly and never creates a DailyLesson");
{
  let state = baseAppData();
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });
  check("start: lessons=[], transitionOverrides=[]", state.lessons.length === 0 && state.transitionOverrides.length === 0);

  actions.setTransitionNote(DATE, SECTION_A, "Bring calculator");
  check("lessons remains []", state.lessons.length === 0);
  check("transitionOverrides.length === 1", state.transitionOverrides.length === 1);
  check("correct date", state.transitionOverrides[0]?.date === DATE);
  check("correct classSectionId", state.transitionOverrides[0]?.classSectionId === SECTION_A);
  check("correct note", state.transitionOverrides[0]?.note === "Bring calculator");

  actions.setTransitionNote(DATE, SECTION_A, "");
  check("22. clearing the note: lessons still []", state.lessons.length === 0);
  check("transitionOverrides returns to []", state.transitionOverrides.length === 0);
}

console.log("\n21b. Same proof, for a custom Materials override instead of a note");
{
  let state = baseAppData();
  const actions = createTransitionOverrideActions((action) => {
    state = appDataReducer(state, action);
  });
  actions.setTransitionMaterialsCustom(DATE, SECTION_A, "Movie day - nothing needed");
  check("a materials override was created with zero lessons in AppData", state.transitionOverrides[0]?.materialsOverride === "Movie day - nothing needed");
  check("21. no DailyLesson created", state.lessons.length === 0);
  actions.setTransitionWarmupCustom(DATE, SECTION_A, "N/A today");
  check("a warmup override coexists on the same row, still zero lessons", state.transitionOverrides[0]?.warmupOverride === "N/A today" && state.lessons.length === 0);
}

// ---------------------------------------------------------------------------
// 5. Live default-preview data (no staleness)
// ---------------------------------------------------------------------------

console.log("\n19-20. The 'current default' preview source (findLessonForSection) reflects the lesson draft immediately, never a stale value");
{
  let state = baseAppData();
  const lessonActions = createLessonActions(state, (action) => {
    state = appDataReducer(state, action);
  });

  lessonActions.updateMaterials(DATE, SECTION_A, "Workbook v1");
  check("19a. materials preview source reads the just-saved value", findLessonForSection(state.lessons, DATE, SECTION_A)?.materials === "Workbook v1");

  const lessonActions2 = createLessonActions(state, (action) => {
    state = appDataReducer(state, action);
  });
  lessonActions2.updateMaterials(DATE, SECTION_A, "Workbook v2 - edited");
  check("19b. editing materials again immediately changes what the preview source would show - no caching/staleness", findLessonForSection(state.lessons, DATE, SECTION_A)?.materials === "Workbook v2 - edited");

  const lessonActions3 = createLessonActions(state, (action) => {
    state = appDataReducer(state, action);
  });
  lessonActions3.updateWarmup(DATE, SECTION_A, "Warm-up v1");
  check("20. warmup preview source reads the just-saved value the same way", findLessonForSection(state.lessons, DATE, SECTION_A)?.warmup === "Warm-up v1");
}

// ---------------------------------------------------------------------------
// 6. applyDiff write isolation
// ---------------------------------------------------------------------------

interface RecordedCall {
  table: string;
  op: "delete" | "upsert";
  rows?: unknown[];
}

function createRecordingClient(): { client: SupabaseClient<Database>; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  function chainable() {
    const builder: {
      eq: () => typeof builder;
      then: (resolve: (value: { data: null; error: null }) => unknown) => unknown;
    } = {
      eq: () => builder,
      then: (resolve) => Promise.resolve(resolve({ data: null, error: null })),
    };
    return builder;
  }
  const client = {
    from(table: string) {
      return {
        delete() {
          calls.push({ table, op: "delete" });
          return chainable();
        },
        upsert(rows: unknown) {
          calls.push({ table, op: "upsert", rows: rows as unknown[] });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

const ctx: OwnerContext = { organizationId: "org-1", membershipId: "membership-1" };

async function runApplyDiffChecks() {
  console.log(
    "\n18/23. Two SEPARATE dispatches (a lesson warmup edit, then a transition-override note edit - each " +
      "autosaves independently, exactly like every other field on this page; this is NOT a transaction and " +
      "not claimed to be one) both end up correctly reflected in AppData, and a save covering both writes " +
      "ONLY lessons and transition_overrides - zero shared-schedule/teacher_period_assignments writes",
  );
  const prev = baseAppData();
  let next = baseAppData();
  const lessonActions = createLessonActions(next, (action) => {
    next = appDataReducer(next, action);
  });
  lessonActions.updateWarmup(DATE, SECTION_A, "1. Solve for x.");
  const transitionActions = createTransitionOverrideActions((action) => {
    next = appDataReducer(next, action);
  });
  transitionActions.setTransitionNote(DATE, SECTION_A, "Reminder: quiz Friday.");

  const recording = createRecordingClient();
  await applyDiff(recording.client, ctx, prev, next);
  const touchedTables = new Set(recording.calls.map((c) => c.table));

  check(
    "18. after both independent, sequential dispatches, the final AppData correctly reflects both edits - consistency of final state, not atomicity of the two dispatches",
    next.lessons[0]?.warmup === "1. Solve for x." && next.transitionOverrides[0]?.note === "Reminder: quiz Friday.",
  );
  check("writes to lessons", touchedTables.has("lessons"));
  check("writes to transition_overrides", touchedTables.has("transition_overrides"));
  check("23. writes ZERO times to bell_schedules", !touchedTables.has("bell_schedules"));
  check("23. writes ZERO times to schedule_blocks", !touchedTables.has("schedule_blocks"));
  check("23. writes ZERO times to schedule_block_overrides", !touchedTables.has("schedule_block_overrides"));
  check("23. writes ZERO times to teacher_period_assignments", !touchedTables.has("teacher_period_assignments"));
}

// ---------------------------------------------------------------------------
// 7. Precise source-structure audits: session cache, zero-mutation-on-
// render, and accessibility. Deliberately scoped regexes against extracted
// sub-blocks of the real source, not whole-file substring checks - see the
// Stage D report's own note on why each one is precise rather than broad.
// ---------------------------------------------------------------------------

function readSource(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

/** The JSX for one `<OverrideModeField legend="X" ... />` call, from its opening tag to the matching `/>` - lets Materials- and Warm-Up-scoped checks run independently without one field's markup leaking into the other's regex match. */
function extractFieldBlock(source: string, legend: string): string {
  const start = source.indexOf(`legend="${legend}"`);
  if (start === -1) throw new Error(`Could not find legend="${legend}" in source`);
  const end = source.indexOf("/>", start);
  if (end === -1) throw new Error(`Could not find the closing "/>" for legend="${legend}"`);
  return source.slice(start, end);
}

const editorSource = readSource("components", "lessons", "TransitionOverrideEditor.tsx");
const materialsBlock = extractFieldBlock(editorSource, "Materials");
const warmupBlock = extractFieldBlock(editorSource, "Warm-Up");

console.log("\nSession-cache structure audit (Materials + Warm-Up)");
check("cache is initialized with plain useState(null) only - not useEffect, not derived from AppData", /const \[materialsCache, setMaterialsCache\] = useState<string \| null>\(null\);/.test(editorSource));
check("same, for warmupCache", /const \[warmupCache, setWarmupCache\] = useState<string \| null>\(null\);/.test(editorSource));
check("TransitionOverrideEditor.tsx never imports/uses useEffect anywhere - nothing runs merely from mounting/rendering", !editorSource.includes("useEffect"));

check(
  "B (materials). onCustomChange updates BOTH the session cache (setMaterialsCache) and the persisted override (actions.setTransitionMaterialsCustom), from the same handler",
  /onCustomChange=\{\(value\) => \{\s*setMaterialsCache\(value\);\s*actions\.setTransitionMaterialsCustom\(date, classSectionId, value\);\s*\}\}/.test(materialsBlock),
);
check(
  "onSelectCustom (materials) computes the seed via resolveCustomizeSeed(materialsCache, lessonMaterials), caches it, THEN persists that same seed - never lessonMaterials directly",
  /onSelectCustom=\{\(\) => \{\s*const seed = resolveCustomizeSeed\(materialsCache, lessonMaterials\);\s*setMaterialsCache\(seed\);\s*actions\.setTransitionMaterialsCustom\(date, classSectionId, seed\);\s*\}\}/.test(materialsBlock),
);
check(
  "onSelectDefault/onSelectHide (materials) do NOT touch materialsCache at all - switching away from Customize never clears the cache",
  /onSelectDefault=\{\(\) => actions\.setTransitionMaterialsDefault\(date, classSectionId\)\}/.test(materialsBlock) &&
    /onSelectHide=\{\(\) => actions\.setTransitionMaterialsHidden\(date, classSectionId\)\}/.test(materialsBlock) &&
    !/onSelectDefault[\s\S]{0,80}setMaterialsCache/.test(materialsBlock) &&
    !/onSelectHide[\s\S]{0,80}setMaterialsCache/.test(materialsBlock),
);

check(
  "B (warmup). onCustomChange updates BOTH setWarmupCache and actions.setTransitionWarmupCustom",
  /onCustomChange=\{\(value\) => \{\s*setWarmupCache\(value\);\s*actions\.setTransitionWarmupCustom\(date, classSectionId, value\);\s*\}\}/.test(warmupBlock),
);
check(
  "onSelectCustom (warmup) computes the seed via resolveCustomizeSeed(warmupCache, lessonWarmup), caches it, THEN persists that same seed",
  /onSelectCustom=\{\(\) => \{\s*const seed = resolveCustomizeSeed\(warmupCache, lessonWarmup\);\s*setWarmupCache\(seed\);\s*actions\.setTransitionWarmupCustom\(date, classSectionId, seed\);\s*\}\}/.test(warmupBlock),
);
check(
  "onSelectDefault/onSelectHide (warmup) do NOT touch warmupCache at all",
  /onSelectDefault=\{\(\) => actions\.setTransitionWarmupDefault\(date, classSectionId\)\}/.test(warmupBlock) &&
    /onSelectHide=\{\(\) => actions\.setTransitionWarmupHidden\(date, classSectionId\)\}/.test(warmupBlock) &&
    !/onSelectDefault[\s\S]{0,80}setWarmupCache/.test(warmupBlock) &&
    !/onSelectHide[\s\S]{0,80}setWarmupCache/.test(warmupBlock),
);

console.log(
  "\n(D. React useState's actual restore-on-remount behavior cannot be exercised without mounting the component - " +
    "see the Stage D report's 'browser-verification limitation' section. The four checks above instead prove, " +
    "precisely, that the wiring implements the resolveCustomizeSeed rule exactly as specified - the SAME pure rule " +
    "unit-tested in isolation above (2b) - which is the strongest offline substitute available.)",
);

console.log("\n16-17. Opening-editor zero-mutation: LessonsScreen's Warm-Up field and TransitionOverrideEditor's mount never dispatch on their own");
{
  const lessonsScreenSource = readSource("components", "lessons", "LessonsScreen.tsx");
  check(
    "LessonsScreen.tsx's Warm-Up textarea only calls actions.updateWarmup from its own onChange, never at render-body top level",
    /onChange=\{\(e\) => actions\.updateWarmup\(date, classSectionId, e\.target\.value\)\}/.test(lessonsScreenSource) &&
      !/^\s*actions\.updateWarmup\(/m.test(lessonsScreenSource),
  );
  check(
    "TransitionOverrideEditor is mounted as plain JSX (<TransitionOverrideEditor ... />), not inside a useEffect/IIFE that could fire a dispatch merely from mounting",
    /<TransitionOverrideEditor\s/.test(lessonsScreenSource) && !/useEffect\([^)]*TransitionOverrideEditor/.test(lessonsScreenSource),
  );
  check(
    "16/17. every actions.setTransition* call site in the editor is wired to an onChange/onClick/onSelect* handler prop, never called at the component's own top-level body",
    /onSelectDefault=\{|onSelectHide=\{|onSelectCustom=\{|onChange=\{|onCustomChange=\{/.test(editorSource) &&
      // The function body's own top-level statements (useAppData, override,
      // materialsMode, the two useState calls) are all indented exactly 2
      // spaces - every real dispatch call site is nested 12+ spaces deep
      // inside a JSX handler prop (verified individually above). A line
      // with 0-2 leading spaces starting with `actions.setTransition` would
      // mean a dispatch fired directly from the component body/render pass
      // itself - this checks none exists, without false-flagging the
      // correctly-indented dispatches inside the multi-statement
      // onSelectCustom/onCustomChange handler bodies.
      !/^ {0,2}actions\.setTransition/m.test(editorSource),
  );
  check(
    "computing materialsMode/warmupMode (getTransitionOverrideMode) is a pure read of override?.materialsOverride/warmupOverride - no dispatch anywhere near it",
    /const materialsMode = getTransitionOverrideMode\(override\?\.materialsOverride\);\s*const warmupMode = getTransitionOverrideMode\(override\?\.warmupOverride\);/.test(
      editorSource,
    ),
  );
}

console.log("\nAccessibility source audit (native radios, not yet manually verified in a live browser - see the report)");
{
  check("real native <input type=\"radio\"> elements are used - no div-only fake radio", /<input\s+type="radio"/.test(editorSource));
  check("radio values are exactly the three modes: default, customize, hide", /value=\{option\.mode\}/.test(editorSource) && /MODE_OPTIONS[\s\S]*mode: "default"/.test(editorSource) && /mode: "customize"/.test(editorSource) && /mode: "hide"/.test(editorSource));
  check(
    "each field's three radios share ONE `name` (native radio grouping) - the name comes from the field's own `name` prop, not per-option",
    /name=\{name\}/.test(editorSource) && !/name=\{`.*option\.mode/.test(editorSource),
  );
  check(
    "each Materials/Warm-Up field group gets its own unique name (scoped by date+classSectionId), so the two fieldsets' radios can never cross-group",
    editorSource.includes("`transition-materials-mode-${date}-${classSectionId}`") &&
      editorSource.includes("`transition-warmup-mode-${date}-${classSectionId}`"),
  );
  check(
    "labels are associated via WRAPPING (the <input> is a child of its <label>) - a valid native alternative to htmlFor/id pairs, not a click-only div",
    /<label[^>]*>\s*<input\s+type="radio"/.test(editorSource),
  );
  check("the radio's checked state is fully controlled from AppData-derived mode, not defaultChecked/local-only state", /checked=\{mode === option\.mode\}/.test(editorSource) && !editorSource.includes("defaultChecked"));
  check("the visually-hidden input is sr-only (still focusable/tabbable/announced), not display:none/hidden (which would remove it from the tab order)", editorSource.includes('className="sr-only"') && !/type="radio"[^>]*hidden/.test(editorSource));
}

runApplyDiffChecks()
  .then(() => {
    console.log(
      "\n(24. Existing Stage A/B/C regression coverage: run `npm run verify:transition-content-stage-a`, " +
        "`-stage-b`, `-stage-c`, and `verify:present-layout` alongside this script - see the Stage D report for " +
        "the combined validation run.)",
    );
    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
