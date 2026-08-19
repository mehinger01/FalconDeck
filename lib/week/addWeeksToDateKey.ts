import { addDaysToDateKey } from "@/lib/schedule/localDate";

/** Adds (or subtracts, for negative `weeks`) whole weeks to a "YYYY-MM-DD" date key. */
export function addWeeksToDateKey(dateKey: string, weeks: number): string {
  return addDaysToDateKey(dateKey, weeks * 7);
}
