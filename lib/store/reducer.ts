import { createDemoAppData } from "@/lib/data/demoData";
import type { AppData } from "@/lib/data/types";
import { clampBellOffsetSeconds } from "@/lib/schedule/time";
import type { BellSchedule } from "@/types/schedule";
import type { AppDataAction } from "./actions";
import { generateId } from "./id";

function updateSchedule(
  data: AppData,
  scheduleId: string,
  update: (schedule: BellSchedule) => BellSchedule,
): AppData {
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
      const wasDefault = state.schedules.find((s) => s.id === action.scheduleId)?.isDefault;
      const remaining = state.schedules.filter((s) => s.id !== action.scheduleId);
      if (wasDefault && !remaining.some((s) => s.isDefault)) {
        remaining[0] = { ...remaining[0], isDefault: true };
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

    case "SET_DEFAULT_SCHEDULE":
      return {
        ...state,
        schedules: state.schedules.map((schedule) => ({
          ...schedule,
          isDefault: schedule.id === action.scheduleId,
        })),
        // There is one canonical normal-day schedule. The Master Calendar
        // follows the teacher's selected default so Week, Present, Demo and
        // lesson-copy workflows cannot silently drift onto different copies.
        schoolCalendar: state.schoolCalendar
          ? { ...state.schoolCalendar, defaultBellScheduleId: action.scheduleId }
          : state.schoolCalendar,
      };

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
