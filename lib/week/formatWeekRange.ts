import { getWeekDates } from "./getWeekDates";

function anchor(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function monthName(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(anchor(dateKey));
}

const yearOf = (dateKey: string) => Number(dateKey.slice(0, 4));
const dayOf = (dateKey: string) => Number(dateKey.slice(8, 10));

/** Short "Mon D" label for a single date key, e.g. "Aug 17" - used in the Week grid's column headers. */
export function formatShortDate(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    anchor(dateKey),
  );
}

/**
 * Human-readable Monday-Friday range for the week containing
 * `weekStartDateKey`, e.g. "August 17–21, 2026", or "August 31 –
 * September 4, 2026" when the week spans a month (or year) boundary.
 * Centralizes week-range formatting so it isn't reimplemented in JSX.
 */
export function formatWeekRange(weekStartDateKey: string): string {
  const [monday, , , , friday] = getWeekDates(weekStartDateKey);
  const startMonth = monthName(monday);
  const endMonth = monthName(friday);
  const startYear = yearOf(monday);
  const endYear = yearOf(friday);

  if (startMonth === endMonth && startYear === endYear) {
    return `${startMonth} ${dayOf(monday)}–${dayOf(friday)}, ${endYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} ${dayOf(monday)} – ${endMonth} ${dayOf(friday)}, ${endYear}`;
  }
  return `${startMonth} ${dayOf(monday)}, ${startYear} – ${endMonth} ${dayOf(friday)}, ${endYear}`;
}
