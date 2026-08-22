/**
 * Classroom presentation settings - Phase 4. Two small, independent
 * pieces: per-section arrival routines, and app-wide classroom-experience
 * defaults. Both are plain data, persisted through the existing
 * DataRepository like everything else in AppData - neither is a new
 * subsystem.
 */

/** At most one per classSectionId - sparse, only sections with a configured routine need an entry. */
export interface ClassPresentationSettings {
  classSectionId: string;
  /** Simple strings shown as a checklist on the transition screen, e.g. "Take out notebook". */
  arrivalInstructions: string[];
}

export interface ClassroomExperienceSettings {
  /** Shown after the final-5:00 threshold, alongside the existing countdown. Blank = nothing shown. */
  finalFiveMessage: string;
  /** Whether the calm end-of-day screen appears when no student-facing class remains today. */
  showEndOfDayScreen: boolean;
  /** Subtitle under the fixed "School Day Complete" heading. */
  endOfDayMessage: string;
  /** Pre-filled text the Clean Screen tool starts with each time it's activated. */
  cleanScreenDefaultMessage: string;
  /** Whether Clean Screen shows a live clock. */
  showClockOnCleanScreen: boolean;
  /** Whether the automatic between-class transition screen shows a countdown at all. */
  transitionCountdownEnabled: boolean;
  /** Whether the transition screen shows the next section's arrival routine (if one is configured). */
  transitionArrivalInstructionsEnabled: boolean;
  /**
   * A teacher-uploaded Present Mode background watermark, as a `data:`
   * URL - never a filesystem path. Produced client-side by resizing/
   * compressing the upload (see lib/present/processWatermarkUpload.ts)
   * before it's persisted through DataRepository like everything else in
   * AppData. `undefined` means "use the built-in OHHS Falcon".
   */
  customWatermarkDataUrl?: string;
  /** Opacity (0-1) applied to the Present Mode watermark, built-in or custom. */
  watermarkOpacity: number;
}

export const DEFAULT_WATERMARK_OPACITY = 0.35;

export const DEFAULT_CLASSROOM_EXPERIENCE_SETTINGS: ClassroomExperienceSettings = {
  finalFiveMessage: "",
  showEndOfDayScreen: true,
  endOfDayMessage: "Have a great afternoon.",
  cleanScreenDefaultMessage: "Work Time",
  showClockOnCleanScreen: true,
  transitionCountdownEnabled: true,
  transitionArrivalInstructionsEnabled: true,
  customWatermarkDataUrl: undefined,
  watermarkOpacity: DEFAULT_WATERMARK_OPACITY,
};
