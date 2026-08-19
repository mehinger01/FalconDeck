import { findLessonForSection } from "@/lib/data/lessons";
import { formatDateKeyLong } from "@/lib/schedule/localDate";
import type { DailyLesson } from "@/types/lesson";
import type { ResolvedScheduleBlock } from "@/types/schedule";

/**
 * Placeholder header block shown when previewing without a specific
 * schedule period selected (or when the section isn't taught on that
 * weekday at all - weekends, holidays, etc.). Deliberately not any real
 * `BlockKind` like "instructional" or "enrichment", so the header never
 * claims to be something it isn't.
 */
export function genericPreviewBlock(classSectionId: string): ResolvedScheduleBlock {
  return {
    id: "preview-generic",
    blockId: "preview-generic",
    label: "No Period Selected",
    kind: "custom",
    customKindLabel: "Preview",
    startTime: "00:00",
    endTime: "00:00",
    classSectionId,
    isOverridden: false,
  };
}

export interface PreviewClassroomProps {
  block: ResolvedScheduleBlock;
  remainingSeconds: number;
  showCountdown: boolean;
  dateKey: string;
  lesson: DailyLesson | null;
  noLessonMessage: string;
}

/**
 * Pure computation of everything `ClassroomView` needs for Preview Mode,
 * kept separate from the component shell (`PreviewPresentScreen`) so it's
 * directly testable without rendering React - see
 * scripts/verify-preview.ts. `showCountdown` is unconditionally `false`
 * and `remainingSeconds` is unconditionally `0`: Preview Mode has no live
 * clock to count down from, and must never fake the final-five-minute
 * countdown, which is a live-scheduling feature (see `getRemainingTime`).
 *
 * Returns `null` when no class section is selected - there's nothing to
 * preview yet, which the caller renders as its own prompt rather than a
 * ClassroomView.
 */
export function resolvePreviewClassroomProps(params: {
  date: string;
  classSectionId: string | null;
  block: ResolvedScheduleBlock | null;
  lessons: DailyLesson[];
}): PreviewClassroomProps | null {
  const { date, classSectionId, block, lessons } = params;
  if (!classSectionId) return null;

  return {
    block: block ?? genericPreviewBlock(classSectionId),
    remainingSeconds: 0,
    showCountdown: false,
    dateKey: date,
    lesson: findLessonForSection(lessons, date, classSectionId),
    noLessonMessage: `No lesson has been prepared for ${formatDateKeyLong(date)}.`,
  };
}
