"use client";

import Link from "next/link";
import { createDemoAppData } from "@/lib/data/demoData";
import { dataRepository } from "@/lib/data/localStorageRepository";
import type { AppData, DataRepository, SaveResult } from "@/lib/data/types";
import type { ClassSection, Course } from "@/types/course";
import type { DailyLesson } from "@/types/lesson";
import type { BellSchedule, ScheduleBlock, ScheduleBlockOverride, Weekday } from "@/types/schedule";
import type { ClassroomExperienceSettings } from "@/types/classPresentation";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import type { SchoolCalendarException, SchoolYearCalendar } from "@/types/calendar";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { generateId } from "./id";
import { createLessonActions, type LessonActions } from "./lessonActions";
import { createLibraryResourceActions, type LibraryResourceActions } from "./libraryResourceActions";
import { appDataReducer } from "./reducer";
import {
  canSave,
  hydrationReducer,
  INITIAL_HYDRATION_STATE,
  shouldShowErrorScreen,
  shouldShowLoadingScreen,
  shouldShowSessionEndedScreen,
  type HydrationState,
} from "./hydrationState";

export interface AppDataActions extends LessonActions, LibraryResourceActions {
  createSchedule: (name: string) => void;
  /** Adds a fully-formed BellSchedule as-is (its id is preserved verbatim) - used for the built-in OHHS Regular Day preset and for committing a successfully-parsed Bell Schedule import. */
  addBuiltInSchedule: (schedule: BellSchedule) => void;
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
  updateTeacherSchedulePreferences: (patch: Partial<TeacherSchedulePreferences>) => void;
  importMasterCalendar: (result: { calendar: SchoolYearCalendar; newBellSchedules: BellSchedule[] }) => void;
  addCalendarException: (exception: SchoolCalendarException) => void;
  updateCalendarException: (exceptionId: string, patch: Partial<Omit<SchoolCalendarException, "id">>) => void;
  deleteCalendarException: (exceptionId: string) => void;
  /** Replaces `data.lessons` wholesale with the already-computed result of `commitLessonImport` - one atomic state replacement, one save. */
  importLessons: (lessons: DailyLesson[]) => void;
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
  /** Load status, separate from `persistence` (which is save-only). See lib/store/hydrationState.ts. */
  hydration: HydrationState;
  /** Re-runs repository.load() from an "error" state. Never reconstructs/swaps the repository - see hydrationState.ts. */
  retryHydration: () => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

/**
 * `repository`/`seedData` default to the real, localStorage-backed
 * singleton - every existing call site (`<AppDataProvider>{children}</AppDataProvider>`
 * at the root layout) is unaffected. Demo Mode is the one other caller:
 * `DemoAppDataProvider` renders this same component with an in-memory
 * `DemoDataRepository` and a rich demo seed instead, giving it a fully
 * separate `AppDataContext` for its subtree - `useAppData()` always
 * resolves to the nearest provider, so no component needs to know which
 * one it's under.
 */
export function AppDataProvider({
  children,
  repository = dataRepository,
  seedData = createDemoAppData,
  blockUntilHydrated = false,
}: {
  children: ReactNode;
  repository?: DataRepository;
  seedData?: () => AppData;
  /**
   * When true, `children` are not rendered until hydration reaches "ready"
   * - a neutral loading screen shows while "loading" instead of the usual
   * seed/default data. Required once a repository whose data must never be
   * shown to the user as if it were real before load() actually confirms
   * that (e.g. a future SupabaseDataRepository) is in use.
   *
   * This is an explicit, caller-supplied policy (see
   * lib/store/selectDataRepository.ts's selectDataRepositoryPolicy) -
   * AppDataProvider never infers it by checking the repository's class, to
   * stay fully repository-agnostic. Default `false` preserves
   * LocalStorageDataRepository's existing immediate-render behavior: seed
   * data shown instantly, swapped for real data almost instantly after -
   * see the lazy-init comment below for why that's safe for a repository
   * whose load() never actually rejects.
   */
  blockUntilHydrated?: boolean;
}) {
  // Lazy-init with seed data so server and first client render match
  // exactly; any saved data is applied after mount (client-only, see
  // effect below).
  const [data, dispatch] = useReducer(appDataReducer, undefined, seedData);
  const [hydration, hydrationDispatch] = useReducer(hydrationReducer, INITIAL_HYDRATION_STATE);
  const [retryToken, setRetryToken] = useState(0);
  const [persistence, setPersistence] = useState<PersistenceState>({ status: "idle", error: null, attempt: 0 });

  const retryHydration = useCallback(() => setRetryToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    hydrationDispatch({ type: "LOAD_START" });
    repository.load().then(
      (loaded) => {
        if (cancelled) return;
        dispatch({ type: "HYDRATE", data: loaded });
        hydrationDispatch({ type: "LOAD_SUCCESS" });
      },
      (error: unknown) => {
        if (cancelled) return;
        hydrationDispatch({
          type: "LOAD_FAILURE",
          message: error instanceof Error ? error.message : "Falcon Deck couldn't load your data.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // `repository` is expected to be stable for this provider's lifetime -
    // see CutoverAppDataProvider, which forces a remount (not a prop swap)
    // whenever the resolved repository should change. `retryToken` is the
    // only thing that re-runs this effect after the first mount.
  }, [repository, retryToken]);

  // Two distinct external signals, never conflated:
  // - "data-changed": rehydrates from another Falcon Deck tab's save (e.g.
  //   Settings saving a new watermark while Present Mode is open
  //   elsewhere). The reducer's own HYDRATE deep-equality check (see
  //   reducer.ts) prevents this from ever looping back and forth
  //   indefinitely between tabs. A failed reload here is a generic,
  //   retry-able problem - same LOAD_FAILURE path the primary hydration
  //   effect uses.
  // - "session-ended": the authority itself is no longer valid (e.g. a
  //   Supabase SIGNED_OUT event). Never attempts a reload - going straight
  //   to a distinct, blocking "your session ended" state is the whole
  //   point of this event being distinguishable from "data-changed" in the
  //   first place (see DataRepository's ExternalChangeEvent doc comment).
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = repository.subscribeToExternalChanges((event) => {
      if (cancelled) return;
      if (event === "session-ended") {
        hydrationDispatch({ type: "SESSION_ENDED" });
        return;
      }
      repository.load().then(
        (loaded) => {
          if (cancelled) return;
          dispatch({ type: "HYDRATE", data: loaded });
          hydrationDispatch({ type: "LOAD_SUCCESS" });
        },
        (error: unknown) => {
          if (cancelled) return;
          hydrationDispatch({
            type: "LOAD_FAILURE",
            message: error instanceof Error ? error.message : "Falcon Deck couldn't load your data.",
          });
        },
      );
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repository]);

  useEffect(() => {
    if (!canSave(hydration)) return; // never save before a successful load, and never after a failed one
    let cancelled = false;
    // Pre-existing pattern, not introduced here: queueMicrotask keeps this
    // setState out of the effect's synchronous body (react-hooks/set-state-in-effect)
    // while still running before repository.save's own microtask resolves.
    queueMicrotask(() => {
      if (!cancelled) setPersistence((prev) => ({ status: "saving", error: prev.error, attempt: prev.attempt + 1 }));
    });
    repository.save(data).then((result: SaveResult) => {
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
  }, [data, repository, hydration]);

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

      addBuiltInSchedule: (schedule) => dispatch({ type: "ADD_SCHEDULE", schedule }),

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

      updateTeacherSchedulePreferences: (patch) =>
        dispatch({ type: "UPDATE_TEACHER_SCHEDULE_PREFERENCES", patch }),
      importMasterCalendar: ({ calendar, newBellSchedules }) =>
        dispatch({ type: "IMPORT_MASTER_CALENDAR", calendar, newBellSchedules }),
      addCalendarException: (exception) => dispatch({ type: "ADD_CALENDAR_EXCEPTION", exception }),
      updateCalendarException: (exceptionId, patch) =>
        dispatch({ type: "UPDATE_CALENDAR_EXCEPTION", exceptionId, patch }),
      deleteCalendarException: (exceptionId) => dispatch({ type: "DELETE_CALENDAR_EXCEPTION", exceptionId }),
      importLessons: (lessons) => dispatch({ type: "IMPORT_LESSONS", lessons }),

      ...createLessonActions(data, dispatch),
      ...createLibraryResourceActions(data, dispatch),
    }),
    [data],
  );

  const value = useMemo<AppDataContextValue>(
    () => ({ data, actions, persistence, hydration, retryHydration }),
    [data, actions, persistence, hydration, retryHydration],
  );

  // A failed load must never let the rest of the app render as if `data`
  // (still whatever seedData produced) were the teacher's real, saved
  // state - so children are replaced entirely by a blocking recovery UI
  // rather than rendered alongside it, regardless of `blockUntilHydrated`.
  // This is the one and only place that decides "is it safe to show real
  // screens yet" - no descendant needs its own hydration check.
  if (shouldShowErrorScreen(hydration)) {
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-1 flex-col items-center justify-center gap-4 bg-falcon-cream-200 px-6 text-center text-falcon-brown-900"
      >
        <p className="text-lg font-semibold">Falcon Deck couldn&apos;t load your data.</p>
        <p className="max-w-md text-sm text-falcon-brown-700/70">{hydration.message}</p>
        <button
          type="button"
          onClick={retryHydration}
          className="rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-semibold text-falcon-cream-100"
        >
          Retry
        </button>
      </div>
    );
  }

  // A confirmed session end (e.g. sign-out) is NOT the same as a transient
  // load failure - Retry would just fail again forever, since the session
  // really is gone, so this never offers it. Previously-loaded `data` is
  // never rendered after this point (same "children replaced entirely"
  // rule as the error screen above), and nothing here falls back to a
  // different repository - the only way out is signing in again, which
  // (via a fresh navigation re-resolving DataAuthorityState) produces a
  // brand-new CutoverAppDataProvider mount, not a resumed one.
  if (shouldShowSessionEndedScreen(hydration)) {
    return (
      <div
        role="alert"
        className="flex min-h-screen flex-1 flex-col items-center justify-center gap-4 bg-falcon-cream-200 px-6 text-center text-falcon-brown-900"
      >
        <p className="text-lg font-semibold">Your Falcon Deck session ended.</p>
        <p className="max-w-md text-sm text-falcon-brown-700/70">Sign in again to continue.</p>
        <Link
          href="/login"
          className="rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-semibold text-falcon-cream-100"
        >
          Sign in again
        </Link>
      </div>
    );
  }

  // `blockUntilHydrated` is the one caller-supplied policy for the
  // "loading" state (see the prop's own doc comment). Off (the default,
  // used for LocalStorageDataRepository), loading is NOT gated: it
  // resolves near-instantly for that repository (its load() never actually
  // rejects), and gating it would reintroduce a server/client render
  // mismatch that the seed-data lazy-init above exists specifically to
  // avoid. On, "loading" shows a neutral placeholder instead of ever
  // exposing seed/default data as if it were the teacher's real,
  // not-yet-loaded cloud state.
  if (shouldShowLoadingScreen(blockUntilHydrated, hydration)) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center bg-falcon-cream-200 text-falcon-brown-900">
        Loading your data…
      </div>
    );
  }

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
