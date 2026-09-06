import type { Weekday } from "@/types/schedule";

/** Falcon Deck's canonical time zone for schedule calculations. */
export const DEFAULT_TIME_ZONE = "America/Detroit";

/** Supported range for the Bell Clock Offset calibration setting, in seconds. */
export const BELL_OFFSET_MIN_SECONDS = -120;
export const BELL_OFFSET_MAX_SECONDS = 120;

/**
 * Clamps a bell-offset value to the supported calibration range, normalized
 * to whole seconds. Non-finite input (NaN, +/-Infinity - e.g. a malformed
 * persisted value, or a momentarily-empty numeric input parsed as NaN)
 * falls back to 0 rather than propagating into schedule/time-shifting math.
 */
export function clampBellOffsetSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const whole = Math.round(seconds);
  return Math.max(BELL_OFFSET_MIN_SECONDS, Math.min(BELL_OFFSET_MAX_SECONDS, whole));
}

/**
 * Applies a bell-calibration offset to a raw Date, shifting the underlying
 * UTC instant (so downstream zoned-time conversion in getZonedNow etc.
 * stays correct across DST transitions - the offset is never applied to a
 * zoned/local time string). The offset is always normalized and clamped via
 * clampBellOffsetSeconds first, so an out-of-range or malformed value can
 * never reach the schedule engine.
 */
export function applyBellOffset(date: Date, offsetSeconds: number): Date {
  return new Date(date.getTime() + clampBellOffsetSeconds(offsetSeconds) * 1000);
}

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

/** Inverse of `timeStringToSeconds` - formats seconds since midnight as "HH:mm" (24h), rounded down to the minute. */
export function secondsToTimeString(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600) % 24;
  const minutes = Math.floor((clamped % 3600) / 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/** Formats a "HH:mm" (24h) time string as "h:mm AM/PM" for display, e.g. "11:18" -> "11:18 AM". */
export function formatTimeString(time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes.toString().padStart(2, "0")} ${period}`;
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
