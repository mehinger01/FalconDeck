import { WEEKDAYS } from "@/types/schedule";
import { addDaysToDateKey, weekdayForDateKey } from "@/lib/schedule/localDate";

const MONDAY_INDEX = WEEKDAYS.indexOf("monday");

/**
 * The Monday ("YYYY-MM-DD") of the school week containing `dateKey`. Monday
 * is the fixed start of the school week throughout `lib/week` - every other
 * helper here is built on top of this one, so a date's "week" is always
 * defined consistently.
 */
export function getWeekStart(dateKey: string): string {
  const currentIndex = WEEKDAYS.indexOf(weekdayForDateKey(dateKey));
  const offsetFromMonday = (currentIndex - MONDAY_INDEX + 7) % 7;
  return addDaysToDateKey(dateKey, -offsetFromMonday);
}
