import type { TransitionOverride } from "@/types/transitionOverride";
import { generateId } from "./id";
import type { AppDataAction } from "./actions";

type Dispatch = (action: AppDataAction) => void;
type OverridePatch = Partial<Pick<TransitionOverride, "materialsOverride" | "warmupOverride" | "note">>;

export interface TransitionOverrideActions {
  /** materialsOverride -> undefined (use the live lesson default). */
  setTransitionMaterialsDefault: (date: string, classSectionId: string) => void;
  /** materialsOverride -> `value` verbatim, even `""` - see TransitionOverride's own tri-state doc comment. */
  setTransitionMaterialsCustom: (date: string, classSectionId: string, value: string) => void;
  /** materialsOverride -> null (explicitly hidden). */
  setTransitionMaterialsHidden: (date: string, classSectionId: string) => void;
  /** warmupOverride -> undefined (use the live lesson default). */
  setTransitionWarmupDefault: (date: string, classSectionId: string) => void;
  /** warmupOverride -> `value` verbatim, even `""`. */
  setTransitionWarmupCustom: (date: string, classSectionId: string, value: string) => void;
  /** warmupOverride -> null (explicitly hidden). */
  setTransitionWarmupHidden: (date: string, classSectionId: string) => void;
  /**
   * A blank/whitespace-only note normalizes to "absent" (trim only ever
   * decides emptiness - see isFullyDefaultTransitionOverride); a non-blank
   * note is stored exactly as typed, internal formatting/line breaks
   * untouched.
   */
  setTransitionNote: (date: string, classSectionId: string, note: string) => void;
}

/**
 * Builds the transition-override slice of `AppDataActions` - mirrors
 * `createLessonActions`'s shape (plain functions closing over the latest
 * `data`/`dispatch`, one `AppDataAction` dispatch per call), but every
 * mutator here dispatches the SAME `SET_TRANSITION_OVERRIDE` action with a
 * one-field patch - the reducer owns finding/creating/deleting the row
 * (including the sparse-row collapse), so nothing here needs to read
 * `data.transitionOverrides` at all.
 */
export function createTransitionOverrideActions(dispatch: Dispatch): TransitionOverrideActions {
  function dispatchPatch(date: string, classSectionId: string, patch: OverridePatch) {
    dispatch({
      type: "SET_TRANSITION_OVERRIDE",
      date,
      classSectionId,
      patch,
      // Only actually used by the reducer if no row exists yet for this
      // (date, classSectionId) - an in-place update reuses the existing
      // row's own id, ignoring this freshly-generated one. Same convention
      // as setTeacherPeriodAssignment's newAssignmentId.
      newOverrideId: generateId("transition-override"),
    });
  }

  return {
    setTransitionMaterialsDefault: (date, classSectionId) =>
      dispatchPatch(date, classSectionId, { materialsOverride: undefined }),
    setTransitionMaterialsCustom: (date, classSectionId, value) =>
      dispatchPatch(date, classSectionId, { materialsOverride: value }),
    setTransitionMaterialsHidden: (date, classSectionId) =>
      dispatchPatch(date, classSectionId, { materialsOverride: null }),

    setTransitionWarmupDefault: (date, classSectionId) =>
      dispatchPatch(date, classSectionId, { warmupOverride: undefined }),
    setTransitionWarmupCustom: (date, classSectionId, value) =>
      dispatchPatch(date, classSectionId, { warmupOverride: value }),
    setTransitionWarmupHidden: (date, classSectionId) =>
      dispatchPatch(date, classSectionId, { warmupOverride: null }),

    setTransitionNote: (date, classSectionId, note) =>
      dispatchPatch(date, classSectionId, { note: note.trim() ? note : undefined }),
  };
}
