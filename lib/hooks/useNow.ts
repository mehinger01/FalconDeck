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
 */
export function useNow(intervalMs: number = 1000): Date | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const id = setInterval(onStoreChange, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );

  const timestamp = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return timestamp === 0 ? null : new Date(timestamp);
}
