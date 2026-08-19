import type { Weekday } from "@/types/schedule";
import { WEEKDAYS } from "@/types/schedule";
import { DEFAULT_TIME_ZONE } from "./time";

/**
 * Resolves `date` to the school-local calendar date, as observed in
 * `timeZone`, formatted "YYYY-MM-DD". This is the single source of truth
 * for "what day is it" for lesson lookup - never slice an ISO string or
 * call `toISOString()` for this, since both are UTC and can land on the
 * wrong side of midnight for any zone behind UTC (all of the US).
 */
export function getLocalDateKey(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  // en-CA renders as "YYYY-MM-DD", which is exactly the key format we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Pure calendar-day arithmetic on a "YYYY-MM-DD" key - no timezone is
 * involved because a date key has no time-of-day component to reinterpret.
 * Anchoring to UTC noon keeps this safe from any DST-related off-by-one.
 */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/** The `Weekday` a "YYYY-MM-DD" key falls on. */
export function weekdayForDateKey(dateKey: string): Weekday {
  const [year, month, day] = dateKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return WEEKDAYS[anchor.getUTCDay()];
}

/** Human-readable "Weekday, Month Day, Year" for a "YYYY-MM-DD" key. */
export function formatDateKeyLong(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(anchor);
}
