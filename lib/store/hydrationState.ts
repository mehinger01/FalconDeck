/**
 * Explicit hydration state machine for AppDataProvider, separate from
 * `PersistenceState` (which tracks *save* outcomes, not load). Exists
 * because the previous `hydrated` ref could only ever represent "not yet
 * hydrated" vs "hydrated" - a repository.load() rejection left it stuck at
 * "not yet" forever, with nothing to distinguish "still loading" from
 * "failed", and nothing surfaced to the UI. "ready" is reachable only via a
 * successful load; a failure is a terminal "error" until an explicit retry.
 */
export type HydrationLoading = { status: "loading" };
export type HydrationReady = { status: "ready" };
export type HydrationError = { status: "error"; message: string };
export type HydrationState = HydrationLoading | HydrationReady | HydrationError;

export type HydrationAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS" }
  | { type: "LOAD_FAILURE"; message: string };

export const INITIAL_HYDRATION_STATE: HydrationState = { status: "loading" };

/**
 * `LOAD_START` is dispatched at the top of every load attempt, including
 * retries - it never runs repository.load() itself and never touches which
 * repository instance is in use, so a retry can never "reconstruct/swap
 * repositories," only re-run load() against the same one.
 */
export function hydrationReducer(state: HydrationState, action: HydrationAction): HydrationState {
  switch (action.type) {
    case "LOAD_START":
      return { status: "loading" };
    case "LOAD_SUCCESS":
      return { status: "ready" };
    case "LOAD_FAILURE":
      return { status: "error", message: action.message };
  }
}

/** The only condition under which AppDataProvider's save effect is allowed to run. */
export function canSave(state: HydrationState): boolean {
  return state.status === "ready";
}

/** A failed load always blocks children, regardless of `blockUntilHydrated` - see AppDataProvider's render logic. */
export function shouldShowErrorScreen(state: HydrationState): state is HydrationError {
  return state.status === "error";
}

/**
 * The "loading" state is blocked only when the caller opted in via
 * `blockUntilHydrated` (see AppDataProvider's prop doc comment) - required
 * once a repository whose data must never be shown as real before load()
 * confirms that is in use.
 */
export function shouldShowLoadingScreen(blockUntilHydrated: boolean, state: HydrationState): boolean {
  return blockUntilHydrated && state.status === "loading";
}

/** True exactly when it's safe to render the app's real children instead of an error/loading placeholder. */
export function shouldRenderChildren(blockUntilHydrated: boolean, state: HydrationState): boolean {
  return !shouldShowErrorScreen(state) && !shouldShowLoadingScreen(blockUntilHydrated, state);
}
