"use client";

import { createDemoAppData } from "@/lib/data/demoData";
import { dataRepository } from "@/lib/data/localStorageRepository";
import type { AppData } from "@/lib/data/types";
import type { ClassSection, Course } from "@/types/course";
import type { BellSchedule, ScheduleBlock, ScheduleBlockOverride, Weekday } from "@/types/schedule";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { generateId } from "./id";
import { createLessonActions, type LessonActions } from "./lessonActions";
import { appDataReducer } from "./reducer";

export interface AppDataActions extends LessonActions {
  createSchedule: (name: string) => void;
  duplicateSchedule: (scheduleId: string) => void;
  deleteSchedule: (scheduleId: string) => void;
  renameSchedule: (scheduleId: string, name: string) => void;
  setDefaultSchedule: (scheduleId: string) => void;
  addBlock: (scheduleId: string) => void;
  updateBlock: (
    scheduleId: string,
    blockId: string,
    patch: Partial<Omit<ScheduleBlock, "id" | "overrides">>,
  ) => void;
  deleteBlock: (scheduleId: string, blockId: string) => void;
  moveBlock: (scheduleId: string, blockId: string, direction: "up" | "down") => void;
  setBlockOverride: (
    scheduleId: string,
    blockId: string,
    override: Omit<ScheduleBlockOverride, "id"> & { id?: string },
  ) => void;
  removeBlockOverride: (scheduleId: string, blockId: string, weekday: Weekday) => void;
  addCourse: (course: Omit<Course, "id">) => void;
  addClassSection: (section: Omit<ClassSection, "id">) => void;
  resetToDemo: () => void;
}

interface AppDataContextValue {
  data: AppData;
  actions: AppDataActions;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  // Lazy-init with demo data so server and first client render match exactly;
  // any saved data is applied after mount (client-only, see effect below).
  const [data, dispatch] = useReducer(appDataReducer, undefined, createDemoAppData);
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    dataRepository.load().then((loaded) => {
      if (cancelled) return;
      dispatch({ type: "HYDRATE", data: loaded });
      hydrated.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return; // avoid clobbering storage before hydration runs
    dataRepository.save(data);
  }, [data]);

  const actions = useMemo<AppDataActions>(
    () => ({
      createSchedule: (name) =>
        dispatch({
          type: "ADD_SCHEDULE",
          schedule: {
            id: generateId("schedule"),
            name,
            isDefault: false,
            timeZone: "America/Detroit",
            blocks: [],
          } satisfies BellSchedule,
        }),

      duplicateSchedule: (scheduleId) =>
        dispatch({
          type: "DUPLICATE_SCHEDULE",
          scheduleId,
          newId: generateId("schedule"),
          newName: (() => {
            const source = data.schedules.find((s) => s.id === scheduleId);
            return source ? `${source.name} (Copy)` : "Untitled Schedule (Copy)";
          })(),
        }),

      deleteSchedule: (scheduleId) => dispatch({ type: "DELETE_SCHEDULE", scheduleId }),
      renameSchedule: (scheduleId, name) => dispatch({ type: "RENAME_SCHEDULE", scheduleId, name }),
      setDefaultSchedule: (scheduleId) => dispatch({ type: "SET_DEFAULT_SCHEDULE", scheduleId }),

      addBlock: (scheduleId) => {
        const schedule = data.schedules.find((s) => s.id === scheduleId);
        const lastBlock = schedule?.blocks[schedule.blocks.length - 1];
        dispatch({
          type: "ADD_BLOCK",
          scheduleId,
          block: {
            id: generateId("block"),
            label: "New Block",
            kind: "instructional",
            startTime: lastBlock?.endTime ?? "08:00",
            endTime: lastBlock?.endTime ?? "08:50",
            classSectionId: null,
            overrides: [],
          } satisfies ScheduleBlock,
        });
      },

      updateBlock: (scheduleId, blockId, patch) =>
        dispatch({ type: "UPDATE_BLOCK", scheduleId, blockId, patch }),
      deleteBlock: (scheduleId, blockId) => dispatch({ type: "DELETE_BLOCK", scheduleId, blockId }),
      moveBlock: (scheduleId, blockId, direction) =>
        dispatch({ type: "MOVE_BLOCK", scheduleId, blockId, direction }),

      setBlockOverride: (scheduleId, blockId, override) =>
        dispatch({
          type: "SET_BLOCK_OVERRIDE",
          scheduleId,
          blockId,
          override: { ...override, id: override.id ?? generateId("override") },
        }),
      removeBlockOverride: (scheduleId, blockId, weekday) =>
        dispatch({ type: "REMOVE_BLOCK_OVERRIDE", scheduleId, blockId, weekday }),

      addCourse: (course) =>
        dispatch({ type: "ADD_COURSE", course: { ...course, id: generateId("course") } }),
      addClassSection: (section) =>
        dispatch({ type: "ADD_CLASS_SECTION", section: { ...section, id: generateId("section") } }),

      resetToDemo: () => dispatch({ type: "RESET_TO_DEMO" }),

      ...createLessonActions(data, dispatch),
    }),
    [data],
  );

  const value = useMemo<AppDataContextValue>(() => ({ data, actions }), [data, actions]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within an AppDataProvider");
  return ctx;
}

/** Convenience selector for the schedule currently marked as default. */
export function useDefaultSchedule(): BellSchedule | null {
  const { data } = useAppData();
  return data.schedules.find((s) => s.isDefault) ?? data.schedules[0] ?? null;
}
