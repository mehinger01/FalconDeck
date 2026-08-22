import { MASTER_CALENDAR_SCHEMA_V1 } from "@/lib/calendar/masterCalendarImport";

/**
 * The prepared Ogemaw Heights High School 2026-27 Master Calendar, in
 * Falcon Deck's own `falcon-deck.master-calendar.v1` import schema - real
 * calendar data, not fictional. Exposed as a raw JSON string (rather than
 * an already-parsed object) so it exercises the exact same
 * parseMasterCalendarJson path a teacher's uploaded file would go through,
 * both in verify:calendar and as Demo Mode's seeded calendar.
 *
 * 2026-08-31 (first student day) isn't listed as its own exception - it's a
 * REGULAR day, which is simply the default for any date inside the school
 * year with no matching exception.
 */
export const OHHS_MASTER_CALENDAR_2026_JSON = JSON.stringify(
  {
    schema: MASTER_CALENDAR_SCHEMA_V1,
    name: "OHHS 2026-27 Master Calendar",
    school: "Ogemaw Heights High School",
    district: "West Branch-Rose City Area Schools",
    schoolYear: "2026-2027",
    timeZone: "America/Detroit",
    firstStudentDay: "2026-08-31",
    lastStudentDay: "2027-06-09",
    importStrategy: "exception_overlay",
    defaultScheduleProfile: "REGULAR",
    exceptions: [
      { startDate: "2026-09-04", endDate: "2026-09-04", type: "no-school", title: "No School" },
      { startDate: "2026-09-07", endDate: "2026-09-07", type: "no-school", title: "Labor Day" },
      {
        startDate: "2026-09-30",
        endDate: "2026-09-30",
        type: "special-bell",
        title: "Early Release",
        scheduleProfile: "OHHS_EARLY_RELEASE_1124",
        dismissalTime: "11:24 AM",
      },
      {
        startDate: "2026-10-30",
        endDate: "2026-10-30",
        type: "special-bell",
        title: "Early Release",
        scheduleProfile: "OHHS_EARLY_RELEASE_1124",
        dismissalTime: "11:24 AM",
      },
      {
        startDate: "2026-11-02",
        endDate: "2026-11-02",
        type: "no-students",
        title: "Teacher Professional Development",
      },
      { startDate: "2026-11-25", endDate: "2026-11-27", type: "no-school", title: "Thanksgiving Break" },
      { startDate: "2026-12-23", endDate: "2027-01-01", type: "no-school", title: "Winter Break" },
      {
        startDate: "2027-01-15",
        endDate: "2027-01-15",
        type: "no-students",
        title: "Teacher Work Day / End First Semester",
      },
      {
        startDate: "2027-01-27",
        endDate: "2027-01-27",
        type: "special-bell",
        title: "Early Release",
        scheduleProfile: "OHHS_EARLY_RELEASE_1124",
        dismissalTime: "11:24 AM",
      },
      { startDate: "2027-02-15", endDate: "2027-02-15", type: "no-students", title: "Teacher PD" },
      {
        startDate: "2027-02-24",
        endDate: "2027-02-24",
        type: "special-bell",
        title: "Early Release + Conferences",
        scheduleProfile: "OHHS_EARLY_RELEASE_1124",
        dismissalTime: "11:24 AM",
      },
      { startDate: "2027-03-26", endDate: "2027-04-02", type: "no-school", title: "Spring Break" },
      {
        startDate: "2027-04-28",
        endDate: "2027-04-28",
        type: "special-bell",
        title: "Early Release",
        scheduleProfile: "OHHS_EARLY_RELEASE_1124",
        dismissalTime: "11:24 AM",
      },
      { startDate: "2027-05-31", endDate: "2027-05-31", type: "no-school", title: "Memorial Day" },
      {
        startDate: "2027-06-09",
        endDate: "2027-06-09",
        type: "special-bell",
        title: "Last Student Day / Half Day",
        scheduleProfile: "OHHS_LAST_DAY_HALF_DAY",
      },
    ],
  },
  null,
  2,
);
