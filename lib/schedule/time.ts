import type { Weekday } from "@/types/schedule";

/** Falcon Deck's canonical time zone for schedule calculations. */
export const DEFAULT_TIME_ZONE = "America/Detroit";

export interface ZonedNow {
  weekday: Weekday;
  hour: number;
  minute: number;
  second: number;
  /** Seconds elapsed since local midnight in the given time zone. */
  secondsSinceMidnight: number;
}

/**
 * Resolves the weekday and time-of-day for `date` as observed in
 * `timeZone`, independent of the timezone the code happens to be running
 * in. This is the single source of truth for "what time is it" throughout
 * the scheduling engine.
 */
export function getZonedNow(
  date: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): ZonedNow {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  const weekday = parts.weekday?.toLowerCase() as Weekday;
  // Some Intl implementations render midnight as hour "24" under hour12:false.
  const hour = parseInt(parts.hour ?? "0", 10) % 24;
  const minute = parseInt(parts.minute ?? "0", 10);
  const second = parseInt(parts.second ?? "0", 10);

  return {
    weekday,
    hour,
    minute,
    second,
    secondsSinceMidnight: hour * 3600 + minute * 60 + second,
  };
}

/** Parses a "HH:mm" (24h) time string into seconds since midnight. */
export function timeStringToSeconds(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 3600 + (minutes || 0) * 60;
}

/** Formats a non-negative second count as "M:SS" for countdown displays. */
export function secondsToClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Human-readable "Weekday, Month Day, Year · H:MM:SS AM/PM" in `timeZone`. */
export function formatZonedDateTime(
  date: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
