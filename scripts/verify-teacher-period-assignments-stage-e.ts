/**
 * Offline verification of Stage E (join-existing-school initiative):
 * teacher_period_assignments - base assignments only, override_weekday
 * always NULL for anything created/edited here. No network, no Supabase
 * project for the reducer/mapper checks; applyDiff's "zero write to
 * bell_schedules/schedule_blocks/schedule_block_overrides" requirement is
 * proven with an in-memory recording fake client (see createRecordingClient
 * below) rather than a live project - verify-supabase-migration.ts is the
 * live-project integration suite and is deliberately not exercised here.
 *
 *   npm run verify:teacher-period-assignments-stage-e
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { appDataReducer } from "@/lib/store/reducer";
import { generateId } from "@/lib/store/id";
import { applyDiff } from "@/lib/data/supabaseDataRepository";
import * as Map_ from "@/lib/data/supabaseMapping";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import type { Database } from "@/lib/data/supabase.types";
import type { AppData } from "@/lib/data/types";
import type { BellSchedule, BlockKind } from "@/types/schedule";
import { WEEKDAYS } from "@/types/schedule";
import type { TeacherPeriodAssignment } from "@/types/teacherPeriodAssignment";
import { isTeachingBlock } from "@/lib/schedule/isTeachingBlock";
import { resolveScheduleForWeekday } from "@/lib/schedule/resolveBlockOverride";
import { resolveSchoolDate } from "@/lib/calendar/resolveSchoolDate";
import { DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS } from "@/types/classPresentation";
import { DEFAULT_TEACHER_SCHEDULE_PREFERENCES } from "@/types/teacherSchedule";
import type { SchoolYearCalendar } from "@/types/calendar";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ctx: OwnerContext = { organizationId: "org-1", membershipId: "membership-1" };

function orgSchedule(id: string): BellSchedule {
  return {
    id,
    name: `Shared Schedule ${id}`,
    ownerType: "organization",
    isDefault: false,
    timeZone: "America/Detroit",
    // One block per BlockKind (Section 4 dispatches SET_TEACHER_PERIOD_ASSIGNMENT
    // against every one of these to prove the reducer's kind guard, not just
    // isTeachingBlock() in isolation). block-1 keeps its original id/kind -
    // several earlier sections already reference it by that id.
    blocks: [
      { id: "block-1", label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: null, overrides: [] },
      { id: "block-enrichment", label: "Enrichment", kind: "enrichment", startTime: "08:50", endTime: "09:10", classSectionId: null, overrides: [] },
      { id: "block-prep", label: "Prep", kind: "prep", startTime: "09:10", endTime: "09:50", classSectionId: null, overrides: [] },
      { id: "block-lunch", label: "Lunch", kind: "lunch", startTime: "09:50", endTime: "10:20", classSectionId: null, overrides: [] },
      { id: "block-passing", label: "Passing", kind: "passing", startTime: "10:20", endTime: "10:25", classSectionId: null, overrides: [] },
      { id: "block-custom", label: "Assembly", kind: "custom", customKindLabel: "Assembly", startTime: "10:25", endTime: "11:00", classSectionId: null, overrides: [] },
    ],
  };
}

function teacherSchedule(): BellSchedule {
  return {
    id: "schedule-teacher-1",
    name: "My Own Schedule",
    ownerType: "teacher",
    isDefault: true,
    timeZone: "America/Detroit",
    blocks: [
      { id: "t-block-1", label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: "section-a", overrides: [] },
    ],
  };
}

function baseAppData(): AppData {
  return {
    courses: [{ id: "course-1", name: "Algebra 1" }],
    classSections: [
      { id: "section-a", courseId: "course-1", name: "Algebra 1 - Period 1" },
      { id: "section-b", courseId: "course-1", name: "Algebra 1 - Period 4" },
    ],
    schedules: [orgSchedule("schedule-org-1"), orgSchedule("schedule-org-2"), teacherSchedule()],
    lessons: [],
    classPresentationSettings: [],
    classroomExperienceSettings: DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS,
    libraryResources: [],
    teacherSchedulePreferences: DEFAULT_TEACHER_SCHEDULE_PREFERENCES,
    schoolCalendar: null,
    teacherPeriodAssignments: [],
  };
}

function findSchedule(data: AppData, id: string): BellSchedule {
  const schedule = data.schedules.find((s) => s.id === id);
  if (!schedule) throw new Error(`fixture error: schedule ${id} not found`);
  return schedule;
}

console.log("1. isTeachingBlock: exactly instructional/enrichment, matching BlockRow.tsx's own allowlist");
check("instructional is a teaching block", isTeachingBlock("instructional"));
check("enrichment is a teaching block", isTeachingBlock("enrichment"));
check("passing is NOT a teaching block", !isTeachingBlock("passing"));
check("lunch is NOT a teaching block", !isTeachingBlock("lunch"));
check("prep is NOT a teaching block", !isTeachingBlock("prep"));
check("custom is NOT a teaching block", !isTeachingBlock("custom"));

console.log("\n2. UUID vs. generateId(): the explicit Stage E decision - never use the prefixed helper for this id");
check("generateId() output does NOT look like a UUID (prefixed, non-UUID text)", !UUID_RE.test(generateId("assignment")));
check("crypto.randomUUID() output DOES look like a UUID", UUID_RE.test(crypto.randomUUID()));

console.log("\n3. SET_TEACHER_PERIOD_ASSIGNMENT: create, reassign (stable id), and clear a BASE assignment");
let state = baseAppData();
const newId1 = crypto.randomUUID();
state = appDataReducer(state, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: "section-a",
  newAssignmentId: newId1,
});
check("exactly one assignment exists after creating", state.teacherPeriodAssignments.length === 1);
check("the assignment uses the freshly-generated id immediately (no round trip needed)", state.teacherPeriodAssignments[0].id === newId1);
check("the assignment is a BASE row (overrideWeekday: null)", state.teacherPeriodAssignments[0].overrideWeekday === null);
check(
  "the assignment references the right schedule/block/section",
  state.teacherPeriodAssignments[0].scheduleId === "schedule-org-1" &&
    state.teacherPeriodAssignments[0].blockId === "block-1" &&
    state.teacherPeriodAssignments[0].classSectionId === "section-a",
);
check(
  "the block's merged classSectionId reflects the new assignment immediately (no reload needed)",
  findSchedule(state, "schedule-org-1").blocks[0].classSectionId === "section-a",
);
check(
  "the OTHER shared schedule is completely untouched (multiple-shared-schedule independence)",
  findSchedule(state, "schedule-org-2").blocks[0].classSectionId === null,
);

const newId2 = crypto.randomUUID();
state = appDataReducer(state, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: "section-b",
  newAssignmentId: newId2,
});
check("reassigning still yields exactly one assignment (update in place, not a second row)", state.teacherPeriodAssignments.length === 1);
check("reassigning REUSES the existing row's id, ignoring the freshly-generated one", state.teacherPeriodAssignments[0].id === newId1);
check("reassigning updates classSectionId", state.teacherPeriodAssignments[0].classSectionId === "section-b");
check("the block's merged classSectionId reflects the reassignment", findSchedule(state, "schedule-org-1").blocks[0].classSectionId === "section-b");

state = appDataReducer(state, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: null,
  newAssignmentId: crypto.randomUUID(),
});
check(
  "clearing REMOVES the row entirely (class_section_id is NOT NULL - unassigned is absence, never an explicit null row)",
  state.teacherPeriodAssignments.length === 0,
);
check("the block's merged classSectionId is cleared back to null", findSchedule(state, "schedule-org-1").blocks[0].classSectionId === null);

console.log("\n4. Block-kind guard: SET_TEACHER_PERIOD_ASSIGNMENT only ever creates an assignment for a teaching block (instructional/enrichment) - every other kind is a no-op. Dispatched through the REAL reducer, not just isTeachingBlock() in isolation or a UI structural check.");
const TEACHING_KIND_BLOCKS: Array<{ kind: BlockKind; blockId: string }> = [
  { kind: "instructional", blockId: "block-1" },
  { kind: "enrichment", blockId: "block-enrichment" },
];
const NON_TEACHING_KIND_BLOCKS: Array<{ kind: BlockKind; blockId: string }> = [
  { kind: "prep", blockId: "block-prep" },
  { kind: "lunch", blockId: "block-lunch" },
  { kind: "passing", blockId: "block-passing" },
  { kind: "custom", blockId: "block-custom" },
];

for (const { kind, blockId } of TEACHING_KIND_BLOCKS) {
  const before = baseAppData();
  const after = appDataReducer(before, {
    type: "SET_TEACHER_PERIOD_ASSIGNMENT",
    scheduleId: "schedule-org-1",
    blockId,
    classSectionId: "section-a",
    newAssignmentId: crypto.randomUUID(),
  });
  check(`${kind} + valid section -> an assignment IS created`, after.teacherPeriodAssignments.length === 1);
  check(
    `${kind} + valid section -> the assignment references the right block/section`,
    after.teacherPeriodAssignments[0]?.blockId === blockId && after.teacherPeriodAssignments[0]?.classSectionId === "section-a",
  );
  check(
    `${kind} + valid section -> the block's merged classSectionId reflects it immediately`,
    findSchedule(after, "schedule-org-1").blocks.find((b) => b.id === blockId)?.classSectionId === "section-a",
  );
}

for (const { kind, blockId } of NON_TEACHING_KIND_BLOCKS) {
  const before = baseAppData();
  const after = appDataReducer(before, {
    type: "SET_TEACHER_PERIOD_ASSIGNMENT",
    scheduleId: "schedule-org-1",
    blockId,
    classSectionId: "section-a",
    newAssignmentId: crypto.randomUUID(),
  });
  check(`${kind} + valid section -> state is UNCHANGED (same reference - the reducer's guard rejects it before building any new object)`, after === before);
  check(`${kind} + valid section -> NO assignment was created`, after.teacherPeriodAssignments.length === 0);
}

console.log("\n5. SET_TEACHER_PERIOD_ASSIGNMENT guards: never touches a teacher-owned schedule, an unknown block, or an unowned class section");
const guardBase = baseAppData();
const afterTeacherOwnedAttempt = appDataReducer(guardBase, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-teacher-1",
  blockId: "t-block-1", // an instructional (teaching-kind) block - the ownerType guard alone must reject this, before the kind guard is even reached
  classSectionId: "section-b",
  newAssignmentId: crypto.randomUUID(),
});
check(
  "dispatching against a TEACHER-owned instructional block is a no-op (same state reference)",
  afterTeacherOwnedAttempt === guardBase,
);
check(
  "dispatching against a TEACHER-owned instructional block creates NO TeacherPeriodAssignment",
  afterTeacherOwnedAttempt.teacherPeriodAssignments.length === 0,
);

const afterUnknownBlockAttempt = appDataReducer(guardBase, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-does-not-exist",
  classSectionId: "section-a",
  newAssignmentId: crypto.randomUUID(),
});
check("dispatching against an unknown blockId is a no-op (same state reference)", afterUnknownBlockAttempt === guardBase);

const afterUnknownSectionAttempt = appDataReducer(guardBase, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: "section-does-not-exist",
  newAssignmentId: crypto.randomUUID(),
});
check(
  "dispatching with a class section the teacher doesn't own is a no-op (same state reference)",
  afterUnknownSectionAttempt === guardBase,
);

console.log("\n6. A pre-existing weekday-specific assignment is preserved untouched - Stage E only ever reads/writes the BASE row");
let weekdayState: AppData = {
  ...baseAppData(),
  teacherPeriodAssignments: [
    { id: "existing-weekday-row", scheduleId: "schedule-org-1", blockId: "block-1", overrideWeekday: "thursday", classSectionId: "section-b" },
  ],
};
const preExistingWeekdayRow = weekdayState.teacherPeriodAssignments[0];
weekdayState = appDataReducer(weekdayState, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: "section-a",
  newAssignmentId: crypto.randomUUID(),
});
check("creating a base assignment alongside an existing weekday row yields exactly two rows", weekdayState.teacherPeriodAssignments.length === 2);
check(
  "the pre-existing weekday-specific row is byte-for-byte unchanged",
  Map_.deepEqual(weekdayState.teacherPeriodAssignments.find((a) => a.id === "existing-weekday-row"), preExistingWeekdayRow),
);
weekdayState = appDataReducer(weekdayState, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: null,
  newAssignmentId: crypto.randomUUID(),
});
check("clearing the base assignment leaves exactly the weekday-specific row behind", weekdayState.teacherPeriodAssignments.length === 1);
check(
  "the surviving row IS the weekday-specific one, still unchanged",
  Map_.deepEqual(weekdayState.teacherPeriodAssignments[0], preExistingWeekdayRow),
);

console.log("\n7. A base assignment applies on every weekday (not weekday-scoped) - resolveScheduleForWeekday agrees for all seven days");
let everyWeekdayState = baseAppData();
everyWeekdayState = appDataReducer(everyWeekdayState, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: "section-a",
  newAssignmentId: crypto.randomUUID(),
});
const sharedScheduleAfterAssignment = findSchedule(everyWeekdayState, "schedule-org-1");
for (const weekday of WEEKDAYS) {
  const resolved = resolveScheduleForWeekday(sharedScheduleAfterAssignment, weekday).find((b) => b.blockId === "block-1");
  check(`resolveScheduleForWeekday(${weekday}) shows the base assignment ("section-a")`, resolved?.classSectionId === "section-a");
}

console.log("\n8. SPECIAL_BELL preservation: a special-bell calendar exception pointing at a shared schedule still shows the merged assignment");
const specialBellCalendar: SchoolYearCalendar = {
  id: "calendar-1",
  name: "Test Calendar",
  schoolYear: "2026-2027",
  timeZone: "America/Detroit",
  firstStudentDay: "2026-08-25",
  lastStudentDay: "2027-06-10",
  defaultBellScheduleId: "schedule-org-1",
  exceptions: [
    { id: "exc-1", startDate: "2026-11-24", endDate: "2026-11-24", type: "special-bell", title: "Early Release", bellScheduleId: "schedule-org-1" },
  ],
};
const specialBellResolution = resolveSchoolDate({
  dateKey: "2026-11-24",
  calendar: specialBellCalendar,
  bellSchedules: everyWeekdayState.schedules,
  teacherPreferences: everyWeekdayState.teacherSchedulePreferences,
});
check("special-bell resolution status is special-schedule", specialBellResolution.status === "special-schedule");
check(
  "the raw bellSchedule's block still carries the merged base assignment",
  specialBellResolution.bellSchedule?.blocks.find((b) => b.id === "block-1")?.classSectionId === "section-a",
);
check(
  "resolvedTeacherSchedule's block still carries the merged base assignment",
  specialBellResolution.resolvedTeacherSchedule?.blocks.find((b) => b.id === "block-1")?.classSectionId === "section-a",
);

console.log("\n9. supabaseMapping round-trip: teacherPeriodAssignmentToRow / rowToTeacherPeriodAssignment");
console.log("    (proves scheduleId+blockId, not a single scheduleBlockId field, is the right local shape: parseScopedCloudId");
console.log("    recovers BOTH from the one scoped schedule_block_id column, with no separate query or parameter needed)");
function withTimestamps<T extends object>(row: T): T & { created_at: string; updated_at: string } {
  return { ...row, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}
const baseAssignment: TeacherPeriodAssignment = {
  id: crypto.randomUUID(),
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  overrideWeekday: null,
  classSectionId: "section-a",
};
const baseRow = Map_.teacherPeriodAssignmentToRow(baseAssignment, ctx);
check(
  "the row's schedule_block_id is the CLOUD-scoped (schedule,block) id, not the raw local block id",
  baseRow.schedule_block_id === Map_.scheduleBlockCloudId("schedule-org-1", "block-1"),
);
check("a base assignment's row has override_weekday: null", baseRow.override_weekday === null);
const baseAssignmentBack = Map_.rowToTeacherPeriodAssignment(withTimestamps(baseRow));
check("a base assignment round-trips exactly", Map_.deepEqual(baseAssignmentBack, baseAssignment));
check(
  "the round trip recovers the original scheduleId exactly ({scheduleId, blockId} -> scoped id -> {scheduleId, blockId})",
  baseAssignmentBack.scheduleId === baseAssignment.scheduleId,
);
check(
  "the round trip recovers the original blockId exactly",
  baseAssignmentBack.blockId === baseAssignment.blockId,
);

const weekdayAssignment: TeacherPeriodAssignment = {
  id: crypto.randomUUID(),
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  overrideWeekday: "thursday",
  classSectionId: "section-b",
};
const weekdayRow = Map_.teacherPeriodAssignmentToRow(weekdayAssignment, ctx);
check("a weekday-specific assignment's row has override_weekday set", weekdayRow.override_weekday === "thursday");
const weekdayAssignmentBack = Map_.rowToTeacherPeriodAssignment(withTimestamps(weekdayRow));
check(
  "a weekday-specific assignment round-trips exactly too (Stage E never creates one, but must never corrupt an existing one)",
  Map_.deepEqual(weekdayAssignmentBack, weekdayAssignment),
);

// ---------------------------------------------------------------------------
// 10-13. applyDiff: zero writes to bell_schedules/schedule_blocks/
//    schedule_block_overrides for an ordinary assignment change - proven
//    with an in-memory recording fake client (no live Supabase project).
// ---------------------------------------------------------------------------

interface RecordedWrite {
  table: string;
  op: "delete" | "upsert";
}

function createRecordingClient(): { client: SupabaseClient<Database>; calls: RecordedWrite[] } {
  const calls: RecordedWrite[] = [];
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
        upsert(_rows: unknown) {
          calls.push({ table, op: "upsert" });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

async function runApplyDiffChecks() {
console.log("\n10. applyDiff: assigning a class section causes ZERO writes to bell_schedules/schedule_blocks/schedule_block_overrides");
const assignPrev = baseAppData();
const assignNext = appDataReducer(assignPrev, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: "section-a",
  newAssignmentId: crypto.randomUUID(),
});
const assignRecording = createRecordingClient();
await applyDiff(assignRecording.client, ctx, assignPrev, assignNext);
const assignTouchedTables = new Set(assignRecording.calls.map((c) => c.table));
check("assigning writes to teacher_period_assignments", assignTouchedTables.has("teacher_period_assignments"));
check(
  "assigning is an upsert (not a delete) on teacher_period_assignments",
  assignRecording.calls.some((c) => c.table === "teacher_period_assignments" && c.op === "upsert"),
);
check("assigning writes ZERO times to bell_schedules", !assignTouchedTables.has("bell_schedules"));
check("assigning writes ZERO times to schedule_blocks", !assignTouchedTables.has("schedule_blocks"));
check("assigning writes ZERO times to schedule_block_overrides", !assignTouchedTables.has("schedule_block_overrides"));

console.log("\n11. applyDiff: clearing a class section causes a delete on teacher_period_assignments, still ZERO writes to the other three tables");
const clearNext = appDataReducer(assignNext, {
  type: "SET_TEACHER_PERIOD_ASSIGNMENT",
  scheduleId: "schedule-org-1",
  blockId: "block-1",
  classSectionId: null,
  newAssignmentId: crypto.randomUUID(),
});
const clearRecording = createRecordingClient();
await applyDiff(clearRecording.client, ctx, assignNext, clearNext);
const clearTouchedTables = new Set(clearRecording.calls.map((c) => c.table));
check(
  "clearing is a delete on teacher_period_assignments",
  clearRecording.calls.some((c) => c.table === "teacher_period_assignments" && c.op === "delete"),
);
check("clearing writes ZERO times to bell_schedules", !clearTouchedTables.has("bell_schedules"));
check("clearing writes ZERO times to schedule_blocks", !clearTouchedTables.has("schedule_blocks"));
check("clearing writes ZERO times to schedule_block_overrides", !clearTouchedTables.has("schedule_block_overrides"));

console.log("\n12. Negative persistence proof: a non-teaching block's rejected assignment attempt writes NOTHING at all - the guard holds at the persistence boundary, not just in the reducer");
for (const { kind, blockId } of NON_TEACHING_KIND_BLOCKS) {
  const negativePrev = baseAppData();
  const negativeNext = appDataReducer(negativePrev, {
    type: "SET_TEACHER_PERIOD_ASSIGNMENT",
    scheduleId: "schedule-org-1",
    blockId,
    classSectionId: "section-a",
    newAssignmentId: crypto.randomUUID(),
  });
  check(`${kind}: the reducer produced no assignment (next.teacherPeriodAssignments is still empty)`, negativeNext.teacherPeriodAssignments.length === 0);
  const negativeRecording = createRecordingClient();
  await applyDiff(negativeRecording.client, ctx, negativePrev, negativeNext);
  check(
    `${kind}: applyDiff(prev, next) writes NOTHING to teacher_period_assignments (there was nothing to diff)`,
    !negativeRecording.calls.some((c) => c.table === "teacher_period_assignments"),
  );
  check(`${kind}: applyDiff(prev, next) writes NOTHING at all across every table`, negativeRecording.calls.length === 0);
}

console.log("\n13. Positive control: a TEACHER-owned schedule's own block edit still writes to schedule_blocks (the org-owned skip isn't over-broad)");
const teacherEditPrev = baseAppData();
const teacherEditNext = appDataReducer(teacherEditPrev, {
  type: "UPDATE_BLOCK",
  scheduleId: "schedule-teacher-1",
  blockId: "t-block-1",
  patch: { label: "Renamed Period 1" },
});
const teacherEditRecording = createRecordingClient();
await applyDiff(teacherEditRecording.client, ctx, teacherEditPrev, teacherEditNext);
check(
  "a teacher-owned schedule's block edit DOES upsert schedule_blocks",
  teacherEditRecording.calls.some((c) => c.table === "schedule_blocks" && c.op === "upsert"),
);
}

runApplyDiffChecks()
  .then(() => {
    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
