/**
 * Fixed calendar dates Demo Mode's scenarios anchor to - deliberately not
 * tied to whatever "today" actually is (Part 15: the demo must work after
 * school, on weekends, over the summer). Every date here falls inside the
 * demo's seeded 2026-27 school year and resolves to the school-day status
 * its scenario name implies - see lib/data/demoModeData.ts, which builds
 * the demo Master Calendar around exactly these dates.
 */
export const DEMO_REGULAR_DATE = "2026-09-15"; // a Tuesday, no exception
export const DEMO_EARLY_RELEASE_DATE = "2026-09-30"; // matches the real OHHS calendar's date, remapped to DEMO_EARLY_RELEASE
export const DEMO_NO_SCHOOL_DATE = "2026-09-07"; // Labor Day
export const DEMO_NO_STUDENTS_DATE = "2026-11-02"; // Teacher PD
export const DEMO_TESTING_DAY_DATE = "2026-10-14"; // synthetic, added only to the demo calendar
export const DEMO_HALF_DAY_NEEDS_CONFIGURATION_DATE = "2027-06-09"; // Last Student Day - deliberately left unconfigured
