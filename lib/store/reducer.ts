import { createDemoAppData } from "@/lib/data/demoData";
import type { AppData } from "@/lib/data/types";
import type { BellSchedule } from "@/types/schedule";
import type { AppDataAction } from "./actions";

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
      return action.data;

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
      return { ...state, schedules: remaining };
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

    case "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS":
      return {
        ...state,
        classroomExperienceSettings: { ...state.classroomExperienceSettings, ...action.patch },
      };

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

    default:
      return state;
  }
}
