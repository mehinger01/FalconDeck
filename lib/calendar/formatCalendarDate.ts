function anchor(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function monthName(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" }).format(anchor(dateKey));
}

const yearOf = (dateKey: string) => Number(dateKey.slice(0, 4));
const dayOf = (dateKey: string) => Number(dateKey.slice(8, 10));

/**
 * Human-readable date or date range for a calendar exception, e.g.
 * "Sep 7, 2026" for a single day, "Sep 4–7, 2026" within one month,
 * "Dec 23, 2026 – Jan 1, 2027" across a year boundary. Deliberately
 * separate from lib/week/formatWeekRange.ts (which only ever formats a
 * fixed Monday-Friday week) since a calendar exception can span any
 * arbitrary range.
 */
export function formatCalendarExceptionDateRange(startDate: string, endDate: string): string {
  if (startDate === endDate) {
    return `${monthName(startDate)} ${dayOf(startDate)}, ${yearOf(startDate)}`;
  }

  const startMonth = monthName(startDate);
  const endMonth = monthName(endDate);
  const startYear = yearOf(startDate);
  const endYear = yearOf(endDate);

  if (startMonth === endMonth && startYear === endYear) {
    return `${startMonth} ${dayOf(startDate)}–${dayOf(endDate)}, ${endYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} ${dayOf(startDate)} – ${endMonth} ${dayOf(endDate)}, ${endYear}`;
  }
  return `${startMonth} ${dayOf(startDate)}, ${startYear} – ${endMonth} ${dayOf(endDate)}, ${endYear}`;
}
