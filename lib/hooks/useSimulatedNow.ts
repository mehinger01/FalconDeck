"use client";

import { useEffect, useState } from "react";

/**
 * Demo Mode's clock: once `baseDate` is set, ticks forward once a second
 * from that starting instant - never frozen, so countdowns/transitions
 * still animate convincingly, but never depends on the actual wall clock
 * beyond that chosen starting point (Part 15: the demo must work after
 * school, on weekends, over the summer). Returns `null` until a scenario
 * has been picked.
 *
 * Compares `baseDate` by timestamp, not reference, since callers
 * typically construct a fresh `Date` on every render for the same
 * logical scenario - reference comparison would reset the clock on every
 * render. The actual time advance only ever happens inside the interval
 * callback (an external timer's async event), never synchronously during
 * render or in an effect body, per React's purity/effect rules.
 */
export function useSimulatedNow(baseDate: Date | null): Date | null {
  const baseTime = baseDate?.getTime() ?? null;
  const [trackedBaseTime, setTrackedBaseTime] = useState<number | null>(baseTime);
  const [simulatedNow, setSimulatedNow] = useState<Date | null>(baseDate);

  if (baseTime !== trackedBaseTime) {
    setTrackedBaseTime(baseTime);
    setSimulatedNow(baseDate);
  }

  useEffect(() => {
    if (baseTime === null) return;
    const id = setInterval(() => {
      setSimulatedNow((prev) => new Date((prev?.getTime() ?? baseTime) + 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [baseTime]);

  return simulatedNow;
}
