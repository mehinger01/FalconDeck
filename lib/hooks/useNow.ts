"use client";

import { useEffect, useState } from "react";

/**
 * Subscribes to the wall clock, ticking once per `intervalMs`. Returns
 * `null` until mounted on the client so server and first client render match.
 *
 * Background tabs are heavily throttled by browsers. When Falcon Deck becomes
 * visible again, regains focus, or is restored from the back/forward cache,
 * resync immediately from the device clock instead of waiting for the next
 * throttled interval.
 *
 * This intentionally uses local state instead of `useSyncExternalStore`.
 * A clock snapshot based directly on `Date.now()` is not stable between React
 * snapshot reads, which can cause repeated renders / maximum-update-depth
 * failures when the tab resumes. State changes only when one of our explicit
 * clock events fires, so the snapshot is stable during rendering.
 */
export function useNow(intervalMs: number = 1000): Date | null {
  const [timestamp, setTimestamp] = useState<number | null>(null);

  useEffect(() => {
    const syncNow = () => setTimestamp(Date.now());
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") syncNow();
    };

    // Establish the first client-side clock value after hydration.
    syncNow();

    const id = window.setInterval(syncNow, intervalMs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", syncNow);
    window.addEventListener("pageshow", syncNow);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", syncNow);
      window.removeEventListener("pageshow", syncNow);
    };
  }, [intervalMs]);

  return timestamp === null ? null : new Date(timestamp);
}
