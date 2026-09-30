import { createDemoAppData } from "@/lib/data/demoData";
import type { AppData } from "@/lib/data/types";
import { clampBellOffsetSeconds } from "@/lib/schedule/time";
import { isTeachingBlock } from "@/lib/schedule/isTeachingBlock";
import { isFullyDefaultTransitionOverride } from "@/lib/data/transitionOverrideMode";
import type { BellSchedule } from "@/types/schedule";
import type { TransitionOverride } from "@/types/transitionOverride";
import type { AppDataAction } from "./actions";
import { generateId } from "./id";

/**
 * Shared by every schedule-editing action (rename, block add/update/
 * delete/move, block overrides). A single choke point for the Stage D
 * invariant "ordinary teacher actions must never mutate an
 * organization-owned schedule" - no per-call-site UI trust required: even
 * if some future control were ever mistakenly rendered for a shared
 * schedule, dispatching against it here is a no-op, and RLS would reject
 * the actual write regardless if this guard were ever bypassed.
 */
function updateSchedule(
  data: AppData,
  scheduleId: string,
  update: (schedule: BellSchedule) => BellSchedule,
): AppData {
  const target = data.schedules.find((schedule) => schedule.id === scheduleId);
  if (target?.ownerType === "organization") return data;
  return {
    ...data,
    schedules: data.schedules.map((schedule) =>
      schedule.id === scheduleId ? update(schedule) : schedule,
    ),
  };
}

/**
 * Pure reducer over the app's in-memory data. Kept free of React and
 * localStorage concerns so it can be unit tested and reasoned about on its
 * own; `AppDataProvider` is the only thing that wires it into React state.
 */
export function appDataReducer(state: AppData, action: AppDataAction): AppData {
  switch (action.type) {
    case "HYDRATE":
      // Returning the *same* state reference when nothing actually changed
      // lets React bail out of re-rendering entirely (its built-in
      // Object.is check on reducer output) - which in turn skips
      // AppDataProvider's save-on-change effect. That's what stops a
      // cross-tab sync loop (tab B saves -> tab A's storage event rehydrates
      // -> tab A's echo-save -> tab B's storage event rehydrates -> ...)
      // from continuing past the point where the two tabs actually agree.
      return JSON.stringify(state) === JSON.stringify(action.data) ? state : action.data;

    case "RESET_TO_DEMO":
      return createDemoAppData();

    case "ADD_SCHEDULE":
      return { ...state, schedules: [...state.schedules, action.schedule] };

    case "DUPLICATE_SCHEDULE": {
      const source = state.schedules.find((s) => s.id === action.scheduleId);
      if (!source) return state;
      const duplicate: BellSchedule = {
        ...structuredClone(source),
        id: action.newId,
        name: action.newName,
        // A duplicate is always teacher-owned going forward, even if its
        // source was organization-owned - duplicating a shared schedule
        // creates the teacher's own private copy, never another shared
        // row. No Stage D UI calls this against an org-owned source yet
        // ("Copy shared schedule" is explicitly deferred), but the
        // reducer's own correctness shouldn't depend on that.
        ownerType: "teacher",
        isDefault: false,
        // A duplicate of a built-in/needs-configuration schedule is a
        // teacher's own editable copy from this point on - "avoid
        // destructive editing" only ever applies to the original. Cleared
        // to `undefined`, not `false` - the local canonical convention for
        // this optional field is to omit it when it doesn't apply, never
        // to store an explicit `false` (see validateMigratedData.ts's
        // normalize(), which exists because a duplicate that manufactured
        // an explicit false here broke a real production migration).
        source: "custom",
        needsConfiguration: undefined,
        // Every nested block/override gets a fresh id - a duplicate must
        // never share a block/override id with its source. Locally these
        // ids only ever needed to be unique within their own schedule, but
        // Supabase's schedule_blocks/schedule_block_overrides tables key on
        // them globally (see Map_.scheduleBlockCloudId), so reusing the
        // source's ids here (as a plain structuredClone would) is exactly
        // the bug that broke a real production migration. Reading from
        // `source` (not the clone) and building new objects via spread
        // means `source` itself is never mutated.
        blocks: source.blocks.map((block) => ({
          ...block,
          id: generateId("block"),
          overrides: block.overrides.map((override) => ({ ...override, id: generateId("override") })),
        })),
      };
      return { ...state, schedules: [...state.schedules, duplicate] };
    }

    case "DELETE_SCHEDULE": {
      if (state.schedules.length <= 1) return state; // always keep at least one schedule
      const target = state.schedules.find((s) => s.id === action.scheduleId);
      // Organization-owned schedules are never deletable from teacher UI -
      // ScheduleList never renders a delete control for them, and RLS would
      // reject the actual write regardless (bell_schedules_delete requires
      // app_is_admin for owner_type='organization'). Refusing here too is
      // defense-in-depth: a shared row must never disappear from local
      // state even if this action were somehow dispatched against one.
      if (target?.ownerType === "organization") return state;
      // Architecture Decision #3 (Stage D): a schedule referenced by
      // activeBellScheduleId must never be silently unselected or
      // reassigned by deleting it out from under the teacher - Supabase's
      // own FK (no ON DELETE clause = NO ACTION) already blocks this at the
      // database level for a cloud-native account; this mirrors that same
      // refusal locally (including for the local/legacy repository, which
      // has no FK to fall back on) so both paths behave identically. The
      // teacher must explicitly choose a different active schedule (or
      // clear the selection) first - see ScheduleList.tsx's own pre-dispatch
      // check for the user-facing message this produces.
      if (action.scheduleId === state.teacherSchedulePreferences.activeBellScheduleId) return state;

      const wasDefault = target?.isDefault;
      const remaining = state.schedules.filter((s) => s.id !== action.scheduleId);
      // Only ever promote another TEACHER-OWNED schedule to isDefault - an
      // organization-owned row's isDefault is admin-controlled shared
      // metadata, never something a teacher's own delete action may flip.
      if (wasDefault && !remaining.some((s) => s.ownerType === "teacher" && s.isDefault)) {
        const promotionIndex = remaining.findIndex((s) => s.ownerType === "teacher");
        if (promotionIndex !== -1) {
          remaining[promotionIndex] = { ...remaining[promotionIndex], isDefault: true };
        }
      }
      const nextDefaultId = remaining.find((s) => s.isDefault)?.id ?? remaining[0]?.id;
      return {
        ...state,
        schedules: remaining,
        schoolCalendar:
          state.schoolCalendar && nextDefaultId
            ? { ...state.schoolCalendar, defaultBellScheduleId: nextDefaultId }
            : state.schoolCalendar,
      };
    }

    case "RENAME_SCHEDULE":
      return updateSchedule(state, action.scheduleId, (schedule) => ({
        ...schedule,
        name: action.name,
      }));

    case "ADD_BLOCK":
      return updateSchedule(state, action.scheduleId, (schedule) => ({
        ...schedule,
        blocks: [...schedule.blocks, action.block],
      }));

    case "UPDATE_BLOCK":
      return updateSchedule(state, action.scheduleId, (schedule) => ({
        ...schedule,
        blocks: schedule.blocks.map((block) =>
          block.id === action.blockId ? { ...block, ...action.patch } : block,
        ),
      }));

    case "DELETE_BLOCK":
      return updateSchedule(state, action.scheduleId, (schedule) => ({
        ...schedule,
        blocks: schedule.blocks.filter((block) => block.id !== action.blockId),
      }));

    case "MOVE_BLOCK":
      return updateSchedule(state, action.scheduleId, (schedule) => {
        const index = schedule.blocks.findIndex((block) => block.id === action.blockId);
        const targetIndex = action.direction === "up" ? index - 1 : index + 1;
        if (index === -1 || targetIndex < 0 || targetIndex >= schedule.blocks.length) {
          return schedule;
        }
        const blocks = [...schedule.blocks];
        [blocks[index], blocks[targetIndex]] = [blocks[targetIndex], blocks[index]];
        return { ...schedule, blocks };
      });

    case "SET_BLOCK_OVERRIDE":
      return updateSchedule(state, action.scheduleId, (schedule) => ({
        ...schedule,
        blocks: schedule.blocks.map((block) => {
          if (block.id !== action.blockId) return block;
          const withoutExisting = block.overrides.filter(
            (o) => o.weekday !== action.override.weekday,
          );
          return { ...block, overrides: [...withoutExisting, action.override] };
        }),
      }));

    case "REMOVE_BLOCK_OVERRIDE":
      return updateSchedule(state, action.scheduleId, (schedule) => ({
        ...schedule,
        blocks: schedule.blocks.map((block) =>
          block.id === action.blockId
            ? { ...block, overrides: block.overrides.filter((o) => o.weekday !== action.weekday) }
            : block,
        ),
      }));

    case "SET_TEACHER_PERIOD_ASSIGNMENT": {
      // The inverse guard of updateSchedule() above: this action exists
      // SPECIFICALLY because a teacher can never write to another owner's
      // bell_schedules/schedule_blocks row (Stage E, join-existing-school
      // initiative) - so unlike every schedule-editing action above, this
      // one only ever operates on an organization-owned schedule. A
      // teacher-owned block's classSectionId is set directly via
      // UPDATE_BLOCK instead.
      const schedule = state.schedules.find((s) => s.id === action.scheduleId);
      if (!schedule || schedule.ownerType !== "organization") return state;
      const block = schedule.blocks.find((b) => b.id === action.blockId);
      if (!block) return state;
      // Application-layer invariant: the database intentionally has no
      // concept of which block kinds may carry a teacher assignment (an
      // ordinary FK on class_section_id says nothing about the referenced
      // block's own kind), so this must be enforced here. Reuses
      // isTeachingBlock rather than re-deriving the same
      // instructional/enrichment predicate inline - see that helper's own
      // doc comment for why it's kept separate from
      // LessonsScreen.tsx/BlockRow.tsx/PresentModeControls.tsx's existing,
      // deliberately-untouched copies.
      if (!isTeachingBlock(block.kind)) return state;
      // Defense-in-depth mirroring teacher_period_assignments' own
      // composite FK (organization_id, owner_membership_id,
      // class_section_id) -> class_sections: never assign a section this
      // teacher doesn't actually have. SharedScheduleAssignmentView's
      // <select> only ever offers the teacher's own sections, so this
      // should never actually reject a real dispatch.
      if (action.classSectionId !== null && !state.classSections.some((s) => s.id === action.classSectionId)) {
        return state;
      }

      // Only the BASE assignment (overrideWeekday: null) for this block is
      // ever read or written here - any weekday-specific row for the same
      // block (Stage E defers weekday reassignment entirely) passes
      // through completely untouched, whether it's kept or not.
      const existingBase = state.teacherPeriodAssignments.find(
        (a) => a.scheduleId === action.scheduleId && a.blockId === action.blockId && a.overrideWeekday === null,
      );
      const withoutExistingBase = state.teacherPeriodAssignments.filter((a) => a !== existingBase);
      const teacherPeriodAssignments =
        action.classSectionId === null
          ? withoutExistingBase // teacher_period_assignments.class_section_id is NOT NULL - "unassigned" is this row's absence, never an explicit null row.
          : [
              ...withoutExistingBase,
              {
                id: existingBase?.id ?? action.newAssignmentId,
                scheduleId: action.scheduleId,
                blockId: action.blockId,
                overrideWeekday: null,
                classSectionId: action.classSectionId,
              },
            ];

      return {
        ...state,
        // teacherPeriodAssignments is the ONLY canonical, editable,
        // persisted state this action changes - this is what applyDiff
        // diffs and writes to teacher_period_assignments.
        teacherPeriodAssignments,
        // Everything below is a DERIVED CLIENT PROJECTION, not an edit to
        // the shared schedule itself: it re-derives, in-memory, the exact
        // same merge rowsToBellSchedule's assignedSectionByBlockId already
        // performs at load() time (see supabaseDataRepository.ts), purely
        // so Present Mode/Week View reflect the new assignment immediately
        // without waiting for a reload. This block/its classSectionId is
        // NEVER sent to schedule_blocks - applyDiff explicitly filters
        // every organization-owned schedule out of its
        // bell_schedules/schedule_blocks/schedule_block_overrides diffing
        // and upserts (see that file's own comments), specifically so this
        // projection can never be mistaken for, or accidentally persisted
        // as, a real edit to a schedule the teacher doesn't own.
        schedules: state.schedules.map((s) =>
          s.id !== action.scheduleId
            ? s
            : {
                ...s,
                blocks: s.blocks.map((b) =>
                  b.id !== action.blockId ? b : { ...b, classSectionId: action.classSectionId },
                ),
              },
        ),
      };
    }

    case "ADD_COURSE":
      return { ...state, courses: [...state.courses, action.course] };

    case "ADD_CLASS_SECTION":
      return { ...state, classSections: [...state.classSections, action.section] };

    case "UPSERT_LESSON": {
      const exists = state.lessons.some((lesson) => lesson.id === action.lesson.id);
      return {
        ...state,
        lessons: exists
          ? state.lessons.map((lesson) => (lesson.id === action.lesson.id ? action.lesson : lesson))
          : [...state.lessons, action.lesson],
      };
    }

    case "DELETE_LESSON":
      return { ...state, lessons: state.lessons.filter((lesson) => lesson.id !== action.lessonId) };

    // The already-computed final lessons array - see
    // lib/lessons/import/lessonImport.ts's commitLessonImport, which is
    // what actually matches courses, resolves conflicts, and builds the
    // full replacement array before this action is ever dispatched. The
    // reducer just applies the result in one atomic state replacement.
    case "IMPORT_LESSONS":
      return { ...state, lessons: action.lessons };

    case "SET_ARRIVAL_INSTRUCTIONS": {
      const exists = state.classPresentationSettings.some(
        (entry) => entry.classSectionId === action.classSectionId,
      );
      const entry = { classSectionId: action.classSectionId, arrivalInstructions: action.instructions };
      return {
        ...state,
        classPresentationSettings: exists
          ? state.classPresentationSettings.map((s) =>
              s.classSectionId === action.classSectionId ? entry : s,
            )
          : [...state.classPresentationSettings, entry],
      };
    }

    case "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS": {
      const patch =
        action.patch.bellOffsetSeconds !== undefined
          ? {
              ...action.patch,
              bellOffsetSeconds: clampBellOffsetSeconds(action.patch.bellOffsetSeconds),
            }
          : action.patch;

      return {
        ...state,
        classroomExperienceSettings: {
          ...state.classroomExperienceSettings,
          ...patch,
        },
      };
    }

    case "UPSERT_LIBRARY_RESOURCE": {
      const exists = state.libraryResources.some((resource) => resource.id === action.resource.id);
      return {
        ...state,
        libraryResources: exists
          ? state.libraryResources.map((resource) =>
              resource.id === action.resource.id ? action.resource : resource,
            )
          : [...state.libraryResources, action.resource],
      };
    }

    case "DELETE_LIBRARY_RESOURCE":
      return {
        ...state,
        libraryResources: state.libraryResources.filter((resource) => resource.id !== action.resourceId),
      };

    case "UPDATE_TEACHER_SCHEDULE_PREFERENCES":
      return {
        ...state,
        teacherSchedulePreferences: { ...state.teacherSchedulePreferences, ...action.patch },
      };

    // Carries the already-computed final calendar + any newly-required
    // "Needs Configuration" placeholder schedules - see
    // lib/calendar/masterCalendarImport.ts's commitMasterCalendarImport,
    // which is what actually merges/conflict-resolves before this action
    // is ever dispatched. The reducer just applies the result.
    case "IMPORT_MASTER_CALENDAR":
      return {
        ...state,
        schoolCalendar: action.calendar,
        schedules: [...state.schedules, ...action.newBellSchedules],
      };

    case "ADD_CALENDAR_EXCEPTION": {
      if (!state.schoolCalendar) return state;
      return {
        ...state,
        schoolCalendar: {
          ...state.schoolCalendar,
          exceptions: [...state.schoolCalendar.exceptions, action.exception],
        },
      };
    }

    case "UPDATE_CALENDAR_EXCEPTION": {
      if (!state.schoolCalendar) return state;
      return {
        ...state,
        schoolCalendar: {
          ...state.schoolCalendar,
          exceptions: state.schoolCalendar.exceptions.map((exception) =>
            exception.id === action.exceptionId ? { ...exception, ...action.patch } : exception,
          ),
        },
      };
    }

    // Teacher Transition Content (Stage D): the ONLY place a
    // TransitionOverride row is created, updated, or deleted. Sparse by
    // construction - a dispatch that leaves every field at its default
    // (materialsOverride/warmupOverride both undefined, note blank) never
    // creates a row, and one that brings an EXISTING row back to fully
    // default deletes it, rather than leaving a stale empty row behind.
    // Writes only AppData.transitionOverrides - never lessons,
    // bell_schedules, schedule_blocks, schedule_block_overrides, or
    // teacher_period_assignments, so this can never become a shared-
    // schedule structural write no matter what a caller passes in.
    case "SET_TRANSITION_OVERRIDE": {
      const existing = state.transitionOverrides.find(
        (o) => o.date === action.date && o.classSectionId === action.classSectionId,
      );
      const merged: TransitionOverride = {
        id: existing?.id ?? action.newOverrideId,
        date: action.date,
        classSectionId: action.classSectionId,
        materialsOverride: "materialsOverride" in action.patch ? action.patch.materialsOverride : existing?.materialsOverride,
        warmupOverride: "warmupOverride" in action.patch ? action.patch.warmupOverride : existing?.warmupOverride,
        note: "note" in action.patch ? action.patch.note : existing?.note,
      };
      const withoutExisting = state.transitionOverrides.filter((o) => o !== existing);
      return {
        ...state,
        transitionOverrides: isFullyDefaultTransitionOverride(merged)
          ? withoutExisting
          : [...withoutExisting, merged],
      };
    }

    case "DELETE_CALENDAR_EXCEPTION": {
      if (!state.schoolCalendar) return state;
      return {
        ...state,
        schoolCalendar: {
          ...state.schoolCalendar,
          exceptions: state.schoolCalendar.exceptions.filter((exception) => exception.id !== action.exceptionId),
        },
      };
    }

    default:
      return state;
  }
}
