/**
 * Pure fullscreen state derivation - no DOM, no React, directly testable.
 * `useFullscreen.ts` is the thin binding that feeds this real
 * `document`/element events; this module only decides what the resulting
 * UI state should be, mirroring the `clockStore.ts`/`useNow.ts` split from
 * the earlier "Maximum update depth exceeded" fix.
 *
 * Never enters/exits fullscreen itself - that stays entirely under the
 * caller's control (only ever from an explicit user click), matching the
 * "never automatic" requirement.
 */

export type FullscreenStatus = "inactive" | "active" | "unsupported";

export interface FullscreenState {
  status: FullscreenStatus;
  /** Set only when `status === "unsupported"` - explains why, and always mentions F11 as a manual fallback. */
  fallbackMessage: string | null;
}

export const INACTIVE_STATE: FullscreenState = { status: "inactive", fallbackMessage: null };

const NOT_SUPPORTED_MESSAGE =
  "Fullscreen isn't available in this browser or context. Try pressing F11 for your browser's own fullscreen mode instead.";

const BLOCKED_MESSAGE =
  "Fullscreen was blocked. Try pressing F11 for your browser's own fullscreen mode instead.";

/** `document.fullscreenEnabled` check, done once up front - not a browser/context that can ever fullscreen at all. */
export function deriveInitialState(fullscreenEnabled: boolean): FullscreenState {
  return fullscreenEnabled ? INACTIVE_STATE : { status: "unsupported", fallbackMessage: NOT_SUPPORTED_MESSAGE };
}

/** A `requestFullscreen()`/`exitFullscreen()` call rejected (blocked mid-session, e.g. a transient permission issue). */
export function deriveErrorState(): FullscreenState {
  return { status: "unsupported", fallbackMessage: BLOCKED_MESSAGE };
}

/**
 * The `fullscreenchange` event fired - `isCurrentlyFullscreen` reflects
 * `document.fullscreenElement === targetElement` at that moment. This is
 * the ONLY path that reflects Escape (the browser exits fullscreen
 * natively and fires this event; there is no separate keydown handler).
 */
export function deriveChangeState(isCurrentlyFullscreen: boolean): FullscreenState {
  return isCurrentlyFullscreen ? { status: "active", fallbackMessage: null } : INACTIVE_STATE;
}
