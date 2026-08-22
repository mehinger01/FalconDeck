"use client";

import { createDemoAppData } from "@/lib/data/demoData";
import { dataRepository } from "@/lib/data/localStorageRepository";
import type { AppData, SaveResult } from "@/lib/data/types";
import type { ClassSection, Course } from "@/types/course";
import type { BellSchedule, ScheduleBlock, ScheduleBlockOverride, Weekday } from "@/types/schedule";
import type { ClassroomExperienceSettings } from "@/types/classPresentation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { generateId } from "./id";
import { createLessonActions, type LessonActions } from "./lessonActions";
import { createLibraryResourceActions, type LibraryResourceActions } from "./libraryResourceActions";
import { appDataReducer } from "./reducer";

export interface AppDataActions extends LessonActions, LibraryResourceActions {
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
  setArrivalInstructions: (classSectionId: string, instructions: string[]) => void;
  updateClassroomExperienceSettings: (patch: Partial<ClassroomExperienceSettings>) => void;
}

/**
 * Outcome of the most recent attempt to persist `data`. Not tied to any
 * one field/action - it's a single global "is the current in-memory state
 * actually saved" signal, which is what any caller (e.g. Settings' Save
 * Branding flow) needs to show accurate save/error feedback without each
 * feature reimplementing its own persistence tracking.
 */
export interface PersistenceState {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
  /**
   * Increments once per save attempt, whether it succeeds or fails. Lets a
   * caller (e.g. Settings' Save Branding flow) detect "a NEW save just
   * happened" even when two consecutive attempts share the same outcome -
   * comparing `status` alone can't tell "nothing has happened yet" apart
   * from "it happened again with the same result."
   */
  attempt: number;
}

interface AppDataContextValue {
  data: AppData;
  actions: AppDataActions;
  persistence: PersistenceState;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  // Lazy-init with demo data so server and first client render match exactly;
  // any saved data is applied after mount (client-only, see effect below).
  const [data, dispatch] = useReducer(appDataReducer, undefined, createDemoAppData);
  const hydrated = useRef(false);
  const [persistence, setPersistence] = useState<PersistenceState>({ status: "idle", error: null, attempt: 0 });

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

  // Rehydrates from another Falcon Deck tab's save (e.g. Settings saving a
  // new watermark while Present Mode is open elsewhere). The reducer's own
  // HYDRATE deep-equality check (see reducer.ts) prevents this from ever
  // looping back and forth indefinitely between tabs.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = dataRepository.subscribeToExternalChanges(() => {
      dataRepository.load().then((loaded) => {
        if (cancelled) return;
        dispatch({ type: "HYDRATE", data: loaded });
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return; // avoid clobbering storage before hydration runs
    let cancelled = false;
    setPersistence((prev) => ({ status: "saving", error: prev.error, attempt: prev.attempt + 1 }));
    dataRepository.save(data).then((result: SaveResult) => {
      if (cancelled) return;
      setPersistence((prev) =>
        result.ok
          ? { status: "saved", error: null, attempt: prev.attempt }
          : { status: "error", error: result.message, attempt: prev.attempt },
      );
    });
    return () => {
      cancelled = true;
    };
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

      setArrivalInstructions: (classSectionId, instructions) =>
        dispatch({ type: "SET_ARRIVAL_INSTRUCTIONS", classSectionId, instructions }),
      updateClassroomExperienceSettings: (patch) =>
        dispatch({ type: "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS", patch }),

      ...createLessonActions(data, dispatch),
      ...createLibraryResourceActions(data, dispatch),
    }),
    [data],
  );

  const value = useMemo<AppDataContextValue>(
    () => ({ data, actions, persistence }),
    [data, actions, persistence],
  );

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
