import { DEMO_EARLY_RELEASE_DATE, DEMO_NO_SCHOOL_DATE, DEMO_NO_STUDENTS_DATE, DEMO_REGULAR_DATE } from "./demoScenarioDates";

/** Fixed -04:00 (EDT) offset, matching this codebase's existing verify-script convention for constructing test instants - see scripts/verify-classroom.ts's atLocalTime. A demo scenario only needs to land on the right calendar date and a plausible hour, not a DST-exact instant. */
function atDemoTime(dateKey: string, time: string): Date {
  return new Date(`${dateKey}T${time}-04:00`);
}

export interface DemoScenario {
  id: string;
  label: string;
  description: string;
  getDate: () => Date;
}

/**
 * Explicit simulation controls (Part 15) - each feeds a concrete `Date`
 * into the exact same LivePresentScreen (and therefore the exact same
 * resolveSchoolDate -> resolveTeacherSchedule -> getPresentationState
 * chain) Live Present Mode uses for the real wall clock. Nothing here is
 * a static screenshot; picking a scenario re-runs the real engine.
 */
export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "during-class",
    label: "During Class",
    description: "8:45 AM - Period 2 (Geometry)",
    getDate: () => atDemoTime(DEMO_REGULAR_DATE, "08:45:00"),
  },
  {
    id: "enrichment",
    label: "Enrichment",
    description: "9:35 AM - Period 3 / Enrichment",
    getDate: () => atDemoTime(DEMO_REGULAR_DATE, "09:35:00"),
  },
  {
    id: "final-five",
    label: "Final 5 Minutes",
    description: "9:18:23 AM - 4:37 left in Period 2",
    getDate: () => atDemoTime(DEMO_REGULAR_DATE, "09:18:23"),
  },
  {
    id: "passing",
    label: "Passing Period",
    description: "9:51 AM - passing toward Period 4",
    getDate: () => atDemoTime(DEMO_REGULAR_DATE, "09:51:00"),
  },
  {
    id: "lunch",
    label: "Lunch",
    description: "11:30 AM - resolves by your selected lunch wave below",
    getDate: () => atDemoTime(DEMO_REGULAR_DATE, "11:30:00"),
  },
  {
    id: "early-release",
    label: "Early Release",
    description: "Sept 30 - Demo Early Release schedule",
    getDate: () => atDemoTime(DEMO_EARLY_RELEASE_DATE, "08:30:00"),
  },
  {
    id: "no-school",
    label: "No School",
    description: "Sept 7 - Labor Day",
    getDate: () => atDemoTime(DEMO_NO_SCHOOL_DATE, "09:00:00"),
  },
  {
    id: "no-students",
    label: "Teacher PD / No Students",
    description: "Nov 2 - Teacher Professional Development",
    getDate: () => atDemoTime(DEMO_NO_STUDENTS_DATE, "09:00:00"),
  },
  {
    id: "end-of-day",
    label: "End of Day",
    description: "3:00 PM - school day complete",
    getDate: () => atDemoTime(DEMO_REGULAR_DATE, "15:00:00"),
  },
];
