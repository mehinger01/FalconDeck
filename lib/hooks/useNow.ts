"use client";

import { useCallback, useSyncExternalStore } from "react";

function getSnapshot(): number {
  return Date.now();
}

// Server (and the client's first hydration pass) has no meaningful "now" -
// a live clock can never match between server-render time and
// client-hydration time, so we render nothing until mounted.
function getServerSnapshot(): number {
  return 0;
}

/**
 * Subscribes to the wall clock, ticking once per `intervalMs`. Returns
 * `null` until mounted on the client, so server and client render
 * identical markup on first paint.
 *
 * Also resyncs immediately on tab-visible/window-focus. Backgrounded tabs
 * get their `setInterval` throttled by the browser (Chrome: as infrequent
 * as once/minute after ~5 minutes hidden), so without this a teacher
 * returning to Falcon Deck could stare at a stale period/countdown for up
 * to a minute even though every consumer already recomputes state fresh
 * from `Date.now()` on each tick. Firing `onStoreChange` on resume forces
 * that recompute instantly instead of waiting for the next throttled tick.
 */
export function useNow(intervalMs: number = 1000): Date | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const id = setInterval(onStoreChange, intervalMs);

      const resync = () => {
        if (document.visibilityState === "visible") onStoreChange();
      };
      document.addEventListener("visibilitychange", resync);
      window.addEventListener("focus", resync);

      return () => {
        clearInterval(id);
        document.removeEventListener("visibilitychange", resync);
        window.removeEventListener("focus", resync);
      };
    },
    [intervalMs],
  );

  const timestamp = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return timestamp === 0 ? null : new Date(timestamp);
}
