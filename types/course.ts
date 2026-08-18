/**
 * Course and section models.
 *
 * A Course is a subject/offering (e.g. "Algebra 1"). A ClassSection is a
 * concrete, schedulable meeting of a course (e.g. "Algebra 1 - Period 1").
 * ScheduleBlocks reference a ClassSection, never a Course directly, so the
 * same course can appear at multiple points in a schedule.
 */

export interface Course {
  id: string;
  name: string;
  /** Optional accent color (hex) used in Schedule Setup and Classes UI. */
  colorHex?: string;
  description?: string;
}

export interface ClassSection {
  id: string;
  courseId: string;
  /** Display name for this section, e.g. "Algebra 1 - Period 1". */
  name: string;
  room?: string;
}
