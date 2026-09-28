/**
 * Offline verification of Stage B of the teacher-transition-content
 * initiative: cloud persistence for `lessons.warmup` and the new
 * `transition_overrides` table (schema + mapping + applyDiff only - no
 * Present Mode UI, no lesson editor UI). No network, no Supabase project -
 * pure functions plus an in-memory recording fake client for the applyDiff
 * checks, exactly like scripts/verify-teacher-period-assignments-stage-e.ts.
 * The live-project integration suite (scripts/verify-supabase-migration.ts)
 * is deliberately not exercised here, per instructions.
 *
 *   npm run verify:transition-content-stage-b
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Map_ from "@/lib/data/supabaseMapping";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import { applyDiff } from "@/lib/data/supabaseDataRepository";
import type { Database } from "@/lib/data/supabase.types";
import type { AppData } from "@/lib/data/types";
import type { DailyLesson } from "@/types/lesson";
import type { TransitionOverride } from "@/types/transitionOverride";
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

const ctx: OwnerContext = { organizationId: "org-1", membershipId: "membership-1" };

// ---------------------------------------------------------------------------
// A. lessons.warmup mapping
// ---------------------------------------------------------------------------

function lesson(overrides: Partial<DailyLesson> = {}): DailyLesson {
  return {
    id: "lesson-1",
    date: "2026-09-29",
    classSectionId: "section-geometry-2",
    learningTarget: "I can find the midpoint of a segment.",
    agendaItems: [],
    resources: [],
    announcements: [],
    materials: undefined,
    warmup: undefined,
    createdAt: "2026-09-29T12:00:00.000Z",
    updatedAt: "2026-09-29T12:00:00.000Z",
    ...overrides,
  };
}

console.log("1. lessons.warmup: undefined round-trips to DB null and back to undefined");
{
  const row = Map_.lessonToRow(lesson(), "course-geometry", ctx);
  check("lessonToRow sends warmup: null for an undefined DailyLesson.warmup", row.warmup === null);
  const roundTripped = Map_.rowsToDailyLesson(row, {
    lesson_id: row.id,
    class_section_id: "section-geometry-2",
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
    lesson_date: row.lesson_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } as unknown as Parameters<typeof Map_.rowsToDailyLesson>[1]);
  check("rowsToDailyLesson maps a null warmup column back to undefined", roundTripped.warmup === undefined);
}

console.log("\n2. lessons.warmup: a real string round-trips exactly");
{
  const warmupText = "1. Find the midpoint of AB. 2. Name the angle pair shown.";
  const row = Map_.lessonToRow(lesson({ warmup: warmupText }), "course-geometry", ctx);
  check("lessonToRow preserves the warmup string verbatim", row.warmup === warmupText);
  const roundTripped = Map_.rowsToDailyLesson(row, {
    lesson_id: row.id,
    class_section_id: "section-geometry-2",
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
    lesson_date: row.lesson_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  } as unknown as Parameters<typeof Map_.rowsToDailyLesson>[1]);
  check("rowsToDailyLesson round-trips the warmup string exactly", roundTripped.warmup === warmupText);
  check("materials is untouched by this change (still undefined)", roundTripped.materials === undefined);
}

// ---------------------------------------------------------------------------
// B. transitionOverrides mapping - tri-state round-trip
// ---------------------------------------------------------------------------

function override(patch: Partial<TransitionOverride> = {}): TransitionOverride {
  return {
    id: "override-1",
    date: "2026-09-29",
    classSectionId: "section-geometry-2",
    ...patch,
  };
}

function roundTrip(o: TransitionOverride): TransitionOverride {
  const row = Map_.transitionOverrideToRow(o, ctx);
  return Map_.rowToTransitionOverride({
    ...row,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as unknown as Parameters<typeof Map_.rowToTransitionOverride>[0]);
}

console.log("\n3-4. materialsOverride: undefined and null round-trip losslessly, distinct from each other");
{
  const undefinedCase = roundTrip(override());
  const row = Map_.transitionOverrideToRow(override(), ctx);
  check("transitionOverrideToRow: undefined materialsOverride -> materials_overridden=false, materials_override=null", row.materials_overridden === false && row.materials_override === null);
  check("round-trip: undefined materialsOverride comes back as undefined, not null", undefinedCase.materialsOverride === undefined);

  const nullCase = roundTrip(override({ materialsOverride: null }));
  const nullRow = Map_.transitionOverrideToRow(override({ materialsOverride: null }), ctx);
  check("transitionOverrideToRow: null materialsOverride -> materials_overridden=true, materials_override=null", nullRow.materials_overridden === true && nullRow.materials_override === null);
  check("round-trip: null materialsOverride comes back as null, not undefined (the two are never conflated)", nullCase.materialsOverride === null);
}

console.log("\n5. materialsOverride: a string round-trips exactly");
{
  const text = "Just a calculator today";
  const row = Map_.transitionOverrideToRow(override({ materialsOverride: text }), ctx);
  check("transitionOverrideToRow: string materialsOverride -> materials_overridden=true, materials_override=<text>", row.materials_overridden === true && row.materials_override === text);
  const result = roundTrip(override({ materialsOverride: text }));
  check("round-trip preserves the exact string", result.materialsOverride === text);
}

console.log("\n6-7. warmupOverride: undefined and null round-trip losslessly, distinct from each other");
{
  const undefinedCase = roundTrip(override());
  const row = Map_.transitionOverrideToRow(override(), ctx);
  check("transitionOverrideToRow: undefined warmupOverride -> warmup_overridden=false, warmup_override=null", row.warmup_overridden === false && row.warmup_override === null);
  check("round-trip: undefined warmupOverride comes back as undefined, not null", undefinedCase.warmupOverride === undefined);

  const nullCase = roundTrip(override({ warmupOverride: null }));
  const nullRow = Map_.transitionOverrideToRow(override({ warmupOverride: null }), ctx);
  check("transitionOverrideToRow: null warmupOverride -> warmup_overridden=true, warmup_override=null", nullRow.warmup_overridden === true && nullRow.warmup_override === null);
  check("round-trip: null warmupOverride comes back as null, not undefined", nullCase.warmupOverride === null);
}

console.log("\n8. warmupOverride: a string round-trips exactly");
{
  const text = "Skip the warm-up, go straight to notes";
  const row = Map_.transitionOverrideToRow(override({ warmupOverride: text }), ctx);
  check("transitionOverrideToRow: string warmupOverride -> warmup_overridden=true, warmup_override=<text>", row.warmup_overridden === true && row.warmup_override === text);
  const result = roundTrip(override({ warmupOverride: text }));
  check("round-trip preserves the exact string", result.warmupOverride === text);
}

console.log("\n9-10. note: absent and text, independent of the tri-state columns entirely");
{
  const absent = roundTrip(override());
  check("note absent on the override -> undefined after round-trip", absent.note === undefined);
  const absentRow = Map_.transitionOverrideToRow(override(), ctx);
  check("transitionOverrideToRow sends note: null when absent", absentRow.note === null);

  const withNote = roundTrip(override({ note: "Homework on desk when bell rings." }));
  check("note text round-trips exactly", withNote.note === "Homework on desk when bell rings.");
}

console.log("\n11. materialsOverride and warmupOverride are independent - overriding one never touches the other");
{
  const result = roundTrip(override({ materialsOverride: "Custom materials", warmupOverride: null }));
  check("materialsOverride carries its own value", result.materialsOverride === "Custom materials");
  check("warmupOverride stays independently null, unaffected by materialsOverride", result.warmupOverride === null);
}

console.log("\n12. identity fields (id/date/classSectionId) and ownership context round-trip correctly");
{
  const o = override({ id: "override-xyz", date: "2026-10-01", classSectionId: "section-algebra-1" });
  const row = Map_.transitionOverrideToRow(o, ctx);
  check("transitionOverrideToRow preserves id/date/classSectionId", row.id === "override-xyz" && row.transition_date === "2026-10-01" && row.class_section_id === "section-algebra-1");
  check("transitionOverrideToRow stamps the caller's organization/membership context", row.organization_id === ctx.organizationId && row.owner_membership_id === ctx.membershipId);
  const result = roundTrip(o);
  check("round-trip preserves id/date/classSectionId exactly", result.id === "override-xyz" && result.date === "2026-10-01" && result.classSectionId === "section-algebra-1");
}

// ---------------------------------------------------------------------------
// C. "Repository fetch" - empty input and multi-row mapping (pure; the live
// fetchAppData() call itself is exercised only by verify-supabase-migration.ts,
// deliberately not run here).
// ---------------------------------------------------------------------------

console.log("\n13. An empty transition_overrides result set maps to an empty array, no crash");
check("[].map(rowToTransitionOverride) is []", [].map(Map_.rowToTransitionOverride).length === 0);

console.log("\n14. Multiple rows each map to their own correct TransitionOverride");
{
  const rows = [
    Map_.transitionOverrideToRow(override({ id: "o-1", classSectionId: "section-a" }), ctx),
    Map_.transitionOverrideToRow(override({ id: "o-2", classSectionId: "section-b", note: "Bring calculators" }), ctx),
  ].map((r) => ({ ...r, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })) as unknown as Parameters<
    typeof Map_.rowToTransitionOverride
  >[0][];
  const mapped = rows.map(Map_.rowToTransitionOverride);
  check("two rows map to two distinct overrides, in order, with no cross-contamination", mapped.length === 2 && mapped[0].id === "o-1" && mapped[0].classSectionId === "section-a" && mapped[1].id === "o-2" && mapped[1].note === "Bring calculators");
}

// ---------------------------------------------------------------------------
// D/E. applyDiff: insert/update/delete + ownership isolation + zero writes
// to lessons/bell_schedules/schedule_blocks/schedule_block_overrides/
// teacher_period_assignments. Same in-memory recording fake client pattern
// as scripts/verify-teacher-period-assignments-stage-e.ts, extended to
// also capture the rows an upsert call actually receives (not just which
// table/op it hit) so ownership fields can be inspected directly.
// ---------------------------------------------------------------------------

interface RecordedCall {
  table: string;
  op: "delete" | "upsert";
  rows?: unknown[];
  eqCalls?: Array<{ column: string; value: unknown }>;
}

function createRecordingClient(): { client: SupabaseClient<Database>; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  function chainable(call: RecordedCall) {
    const builder: {
      eq: (column: string, value: unknown) => typeof builder;
      then: (resolve: (value: { data: null; error: null }) => unknown) => unknown;
    } = {
      eq: (column: string, value: unknown) => {
        call.eqCalls = call.eqCalls ?? [];
        call.eqCalls.push({ column, value });
        return builder;
      },
      then: (resolve) => Promise.resolve(resolve({ data: null, error: null })),
    };
    return builder;
  }
  const client = {
    from(table: string) {
      return {
        delete() {
          const call: RecordedCall = { table, op: "delete" };
          calls.push(call);
          return chainable(call);
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

function emptyAppData(): AppData {
  return {
    courses: [],
    classSections: [{ id: "section-geometry-2", courseId: "course-geometry", name: "Geometry - Period 2" }],
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

async function runApplyDiffChecks() {
  console.log("\n15. applyDiff: adding a transition override is an INSERT-shaped upsert to transition_overrides only");
  const insertPrev = emptyAppData();
  const insertNext: AppData = { ...insertPrev, transitionOverrides: [override({ materialsOverride: "Custom materials" })] };
  const insertRecording = createRecordingClient();
  await applyDiff(insertRecording.client, ctx, insertPrev, insertNext);
  const insertTouchedTables = new Set(insertRecording.calls.map((c) => c.table));
  check("writes to transition_overrides", insertTouchedTables.has("transition_overrides"));
  const insertCall = insertRecording.calls.find((c) => c.table === "transition_overrides");
  check("the write is an upsert, not a delete", insertCall?.op === "upsert");
  const insertedRow = (insertCall?.rows ?? [])[0] as Record<string, unknown> | undefined;
  check("the emitted row carries the CURRENT caller's organization_id", insertedRow?.organization_id === ctx.organizationId);
  check("the emitted row carries the CURRENT caller's owner_membership_id", insertedRow?.owner_membership_id === ctx.membershipId);
  check("writes ZERO times to lessons", !insertTouchedTables.has("lessons"));
  check("writes ZERO times to bell_schedules", !insertTouchedTables.has("bell_schedules"));
  check("writes ZERO times to schedule_blocks", !insertTouchedTables.has("schedule_blocks"));
  check("writes ZERO times to schedule_block_overrides", !insertTouchedTables.has("schedule_block_overrides"));
  check("writes ZERO times to teacher_period_assignments", !insertTouchedTables.has("teacher_period_assignments"));

  console.log("\n16. applyDiff: changing an existing override's fields is an UPDATE-shaped upsert, still isolated");
  const updatePrev = insertNext;
  const updateNext: AppData = {
    ...updatePrev,
    transitionOverrides: [override({ materialsOverride: "Custom materials", warmupOverride: null, note: "Movie day" })],
  };
  const updateRecording = createRecordingClient();
  await applyDiff(updateRecording.client, ctx, updatePrev, updateNext);
  const updateTouchedTables = new Set(updateRecording.calls.map((c) => c.table));
  check("the changed override produces exactly one upsert to transition_overrides", updateRecording.calls.filter((c) => c.table === "transition_overrides").length === 1 && updateRecording.calls.find((c) => c.table === "transition_overrides")?.op === "upsert");
  check("writes ZERO times to any shared-schedule or teacher_period_assignments table", !updateTouchedTables.has("bell_schedules") && !updateTouchedTables.has("schedule_blocks") && !updateTouchedTables.has("schedule_block_overrides") && !updateTouchedTables.has("teacher_period_assignments"));

  console.log("\n17. applyDiff: removing an override is a DELETE on transition_overrides only, by id");
  const deletePrev = updateNext;
  const deleteNext: AppData = { ...deletePrev, transitionOverrides: [] };
  const deleteRecording = createRecordingClient();
  await applyDiff(deleteRecording.client, ctx, deletePrev, deleteNext);
  const deleteTouchedTables = new Set(deleteRecording.calls.map((c) => c.table));
  const deleteCall = deleteRecording.calls.find((c) => c.table === "transition_overrides");
  check("the removal is a delete on transition_overrides", deleteCall?.op === "delete");
  check("the delete filters by the override's own id", deleteCall?.eqCalls?.some((e) => e.column === "id" && e.value === "override-1") ?? false);
  check("writes ZERO times to lessons/bell_schedules/schedule_blocks/schedule_block_overrides/teacher_period_assignments", !deleteTouchedTables.has("lessons") && !deleteTouchedTables.has("bell_schedules") && !deleteTouchedTables.has("schedule_blocks") && !deleteTouchedTables.has("schedule_block_overrides") && !deleteTouchedTables.has("teacher_period_assignments"));

  console.log("\n18. applyDiff: an unrelated save (no transitionOverrides change at all) writes NOTHING to transition_overrides");
  const noopPrev = emptyAppData();
  const noopNext: AppData = { ...noopPrev, classroomExperienceSettings: { ...noopPrev.classroomExperienceSettings, finalFiveMessage: "Wrap it up!" } };
  const noopRecording = createRecordingClient();
  await applyDiff(noopRecording.client, ctx, noopPrev, noopNext);
  check("no transition_overrides write occurred", !noopRecording.calls.some((c) => c.table === "transition_overrides"));
}

// ---------------------------------------------------------------------------
// 19-22. Schema-hardening review: the exact four DB states for both
// materials and warmup. A/B/C go through the real rowToTransitionOverride
// against a hand-built row (bypassing transitionOverrideToRow, which can
// never itself produce state D); D is verified by inspecting the
// migration's own CHECK constraint text, NOT by applying the migration
// merely to test a rejection.
// ---------------------------------------------------------------------------

function rawRow(patch: Partial<Map_.TransitionOverridesRow>): Map_.TransitionOverridesRow {
  return {
    id: "override-raw",
    organization_id: ctx.organizationId,
    owner_membership_id: ctx.membershipId,
    class_section_id: "section-geometry-2",
    transition_date: "2026-09-29",
    materials_overridden: false,
    materials_override: null,
    warmup_overridden: false,
    warmup_override: null,
    note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

console.log("\n19. MATERIALS - states A/B/C");
check("A. materials_overridden=false + materials_override=NULL -> TypeScript undefined", Map_.rowToTransitionOverride(rawRow({})).materialsOverride === undefined);
check("B. materials_overridden=true + materials_override=NULL -> TypeScript null", Map_.rowToTransitionOverride(rawRow({ materials_overridden: true, materials_override: null })).materialsOverride === null);
check("C. materials_overridden=true + materials_override='Workbook' -> TypeScript 'Workbook'", Map_.rowToTransitionOverride(rawRow({ materials_overridden: true, materials_override: "Workbook" })).materialsOverride === "Workbook");

console.log("\n20. WARM-UP - states A/B/C");
check("A. warmup_overridden=false + warmup_override=NULL -> TypeScript undefined", Map_.rowToTransitionOverride(rawRow({})).warmupOverride === undefined);
check("B. warmup_overridden=true + warmup_override=NULL -> TypeScript null", Map_.rowToTransitionOverride(rawRow({ warmup_overridden: true, warmup_override: null })).warmupOverride === null);
check("C. warmup_overridden=true + warmup_override='Workbook' -> TypeScript 'Workbook'", Map_.rowToTransitionOverride(rawRow({ warmup_overridden: true, warmup_override: "Workbook" })).warmupOverride === "Workbook");

console.log(
  "\n21. MATERIALS/WARM-UP - state D (overridden=false + non-null override text) is rejected by a DB schema " +
    "invariant, not just by the mapping layer - verified by inspecting the migration's own CHECK constraint text " +
    "(the migration is never applied here just to test a rejection)",
);
{
  const migrationSql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260927150100_transition_content_stage_b_transition_overrides.sql"),
    "utf8",
  );
  check(
    "the migration defines transition_overrides_materials_override_consistency: CHECK (materials_overridden OR materials_override IS NULL)",
    /constraint\s+transition_overrides_materials_override_consistency\s+check\s*\(\s*materials_overridden\s+or\s+materials_override\s+is\s+null\s*\)/i.test(
      migrationSql,
    ),
  );
  check(
    "the migration defines transition_overrides_warmup_override_consistency: CHECK (warmup_overridden OR warmup_override IS NULL)",
    /constraint\s+transition_overrides_warmup_override_consistency\s+check\s*\(\s*warmup_overridden\s+or\s+warmup_override\s+is\s+null\s*\)/i.test(
      migrationSql,
    ),
  );
  check(
    "no CHECK constraint imposes a non-empty-text or trim restriction - only the FALSE+text combination is disallowed",
    !/check\s*\([^)]*trim\(/i.test(migrationSql) && !/check\s*\([^)]*(<>|!=)\s*''/i.test(migrationSql),
  );
}

console.log(
  "\n22. Mapping-layer defense in depth: even a row hand-built to represent the disallowed state (overridden=false " +
    "with non-null text - impossible once the migration is applied) never surfaces that text through the app",
);
check(
  "a FALSE+text row still maps to undefined, never the stray text - the mapping layer agrees with the DB invariant rather than contradicting it",
  Map_.rowToTransitionOverride(rawRow({ materials_overridden: false, materials_override: "should never surface" })).materialsOverride === undefined,
);

runApplyDiffChecks()
  .then(() => {
    console.log(
      "\n(23-24. Existing shared-schedule/teacher-period-assignment safety and Stage E's own regression coverage: " +
        "run `npm run verify:teacher-period-assignments-stage-e` and `npm run verify:supabase-mapping` alongside this " +
        "script - see the Stage B report for the combined validation run.)",
    );
    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
