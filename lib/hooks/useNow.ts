"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createClockStore, type ClockStoreDeps } from "./clockStore";

// Server (and the client's first hydration pass) has no meaningful "now" -
// a live clock can never match between server-render time and
// client-hydration time, so we render nothing until mounted.
function getServerSnapshot(): number {
  return 0;
}

const browserClockDeps: ClockStoreDeps = {
  now: () => Date.now(),
  setInterval: (handler, intervalMs) => setInterval(handler, intervalMs),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  addVisibilityChangeListener: (handler) => document.addEventListener("visibilitychange", handler),
  removeVisibilityChangeListener: (handler) => document.removeEventListener("visibilitychange", handler),
  addFocusListener: (handler) => window.addEventListener("focus", handler),
  removeFocusListener: (handler) => window.removeEventListener("focus", handler),
  addPageShowListener: (handler) => window.addEventListener("pageshow", handler),
  removePageShowListener: (handler) => window.removeEventListener("pageshow", handler),
  isVisible: () => document.visibilityState === "visible",
};

/**
 * Subscribes to the wall clock, ticking once per `intervalMs`. Returns
 * `null` until mounted on the client so server and first client render match.
 *
 * All of the actual subscribe/getSnapshot/cache logic - including why the
 * snapshot must be cached at all, and the visibility/focus/pageshow resync
 * (background tabs, regained focus, and back/forward-cache restoration) -
 * lives in `createClockStore` (pure, no React, directly testable without a
 * DOM; see scripts/verify-clockstore.ts). This hook only creates one store
 * instance per `intervalMs` and wires it to React.
 */
export function useNow(intervalMs: number = 1000): Date | null {
  const store = useMemo(() => createClockStore(intervalMs, browserClockDeps), [intervalMs]);
  const timestamp = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
  return timestamp === 0 ? null : new Date(timestamp);
}
