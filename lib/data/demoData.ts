import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import type { ClassSection, Course } from "@/types/course";
import type { BellSchedule } from "@/types/schedule";
import type { AppData } from "./types";

/**
 * ---------------------------------------------------------------------
 * PLACEHOLDER / DEMO DATA
 *
 * Everything in this file is fictional seed data for exercising Falcon
 * Deck's schedule engine and UI. None of it is the official Ogemaw
 * Heights High School bell schedule, course list, or roster. Replace it
 * (or point `lib/data` at a different DataRepository entirely) before
 * using this app for real classroom presentation.
 * ---------------------------------------------------------------------
 */

export const DEMO_COURSES: Course[] = [
  { id: "course-algebra-1", name: "Algebra 1", colorHex: "#8B5E34" },
  { id: "course-geometry", name: "Geometry", colorHex: "#C9A227" },
  { id: "course-enrichment", name: "Enrichment", colorHex: "#6B7C59" },
  { id: "course-sat-prep", name: "SAT Prep", colorHex: "#9B5145" },
  { id: "course-prep", name: "Prep", colorHex: "#7A7267" },
];

export const DEMO_CLASS_SECTIONS: ClassSection[] = [
  { id: "section-algebra-1-p1", courseId: "course-algebra-1", name: "Algebra 1 — Period 1" },
  { id: "section-algebra-1-p4", courseId: "course-algebra-1", name: "Algebra 1 — Period 4" },
  { id: "section-geometry-p2", courseId: "course-geometry", name: "Geometry — Period 2" },
  { id: "section-geometry-p6", courseId: "course-geometry", name: "Geometry — Period 6" },
  { id: "section-enrichment-open", courseId: "course-enrichment", name: "Enrichment — Open" },
  {
    id: "section-sat-prep-thursday",
    courseId: "course-sat-prep",
    name: "SAT Prep — Thursday Enrichment",
  },
  { id: "section-prep", courseId: "course-prep", name: "Prep — Planning Period" },
];

const STANDARD_DAY_SCHEDULE: BellSchedule = {
  id: "schedule-demo-standard",
  name: "Demo Standard Day (Placeholder)",
  description:
    "Placeholder demo schedule — not the official OHHS bell schedule. Used to exercise the schedule engine.",
  isDefault: true,
  timeZone: DEFAULT_TIME_ZONE,
  blocks: [
    {
      id: "block-period-1",
      label: "Period 1",
      kind: "instructional",
      startTime: "07:55",
      endTime: "08:45",
      classSectionId: "section-algebra-1-p1",
      overrides: [],
    },
    {
      id: "block-period-2",
      label: "Period 2",
      kind: "instructional",
      startTime: "08:49",
      endTime: "09:39",
      classSectionId: "section-geometry-p2",
      overrides: [],
    },
    {
      id: "block-passing-1",
      label: "Passing Period",
      kind: "passing",
      startTime: "09:39",
      endTime: "09:44",
      classSectionId: null,
      overrides: [],
    },
    {
      id: "block-enrichment",
      label: "Enrichment",
      kind: "enrichment",
      startTime: "09:48",
      endTime: "10:08",
      classSectionId: "section-enrichment-open",
      overrides: [
        {
          id: "override-enrichment-thursday",
          weekday: "thursday",
          label: "SAT Prep",
          kind: "instructional",
          classSectionId: "section-sat-prep-thursday",
        },
      ],
    },
    {
      id: "block-period-4",
      label: "Period 4",
      kind: "instructional",
      startTime: "10:12",
      endTime: "11:02",
      classSectionId: "section-algebra-1-p4",
      overrides: [],
    },
    {
      id: "block-prep",
      label: "Prep",
      kind: "prep",
      startTime: "11:06",
      endTime: "11:56",
      classSectionId: "section-prep",
      overrides: [],
    },
    {
      id: "block-lunch",
      label: "Lunch",
      kind: "lunch",
      startTime: "11:56",
      endTime: "12:26",
      classSectionId: null,
      overrides: [],
    },
    {
      id: "block-period-6",
      label: "Period 6",
      kind: "instructional",
      startTime: "12:30",
      endTime: "13:20",
      classSectionId: "section-geometry-p6",
      overrides: [],
    },
  ],
};

const HALF_DAY_SCHEDULE: BellSchedule = {
  id: "schedule-demo-half-day",
  name: "Demo Half Day (Placeholder)",
  description:
    "Placeholder demo schedule — a second example schedule to demonstrate duplicating schedules and switching the default.",
  isDefault: false,
  timeZone: DEFAULT_TIME_ZONE,
  blocks: [
    {
      id: "block-half-period-1",
      label: "Period 1",
      kind: "instructional",
      startTime: "08:00",
      endTime: "08:40",
      classSectionId: "section-algebra-1-p1",
      overrides: [],
    },
    {
      id: "block-half-period-2",
      label: "Period 2",
      kind: "instructional",
      startTime: "08:44",
      endTime: "09:24",
      classSectionId: "section-geometry-p2",
      overrides: [],
    },
    {
      id: "block-half-enrichment",
      label: "Enrichment",
      kind: "enrichment",
      startTime: "09:28",
      endTime: "09:48",
      classSectionId: "section-enrichment-open",
      overrides: [],
    },
    {
      id: "block-half-prep",
      label: "Prep",
      kind: "prep",
      startTime: "09:52",
      endTime: "10:32",
      classSectionId: "section-prep",
      overrides: [],
    },
  ],
};

export const DEMO_SCHEDULES: BellSchedule[] = [STANDARD_DAY_SCHEDULE, HALF_DAY_SCHEDULE];

export function createDemoAppData(): AppData {
  // Deep clone so callers can freely mutate their own copy of the seed.
  return structuredClone({
    courses: DEMO_COURSES,
    classSections: DEMO_CLASS_SECTIONS,
    schedules: DEMO_SCHEDULES,
  });
}
