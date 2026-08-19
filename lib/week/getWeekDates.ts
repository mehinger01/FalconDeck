import { addDaysToDateKey } from "@/lib/schedule/localDate";
import { getWeekStart } from "./getWeekStart";

/**
 * The five school-week planning dates (Monday-Friday, "YYYY-MM-DD") for the
 * week containing `weekStartDateKey`. Normalizes through `getWeekStart`
 * itself, so it's safe to call with any date in the week, not just a
 * Monday.
 */
export function getWeekDates(weekStartDateKey: string): string[] {
  const monday = getWeekStart(weekStartDateKey);
  return Array.from({ length: 5 }, (_, index) => addDaysToDateKey(monday, index));
}
