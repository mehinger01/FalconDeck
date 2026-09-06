"use client";

import { useNow } from "./useNow";
import { applyBellOffset } from "@/lib/schedule/time";

/**
 * `useNow`, recalibrated by the Bell Clock Offset. A pure composition layer
 * over the already-hardened `useNow` - no interval, no visibility/focus
 * listeners, no local state of its own. `useNow` remains the single place
 * that subscribes to the system clock; this just reshapes the Date it
 * returns.
 */
export function useEffectiveNow(offsetSeconds: number, intervalMs: number = 1000): Date | null {
  const systemNow = useNow(intervalMs);
  return systemNow ? applyBellOffset(systemNow, offsetSeconds) : null;
}
