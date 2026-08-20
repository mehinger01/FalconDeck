"use client";

import { useEffect } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { resolvePreviewClassroomProps } from "@/lib/present/resolvePreviewClassroomProps";
import { formatDateKeyLong } from "@/lib/schedule/localDate";
import type { DailyLesson } from "@/types/lesson";
import type { ResolvedScheduleBlock } from "@/types/schedule";
import { ClassroomView } from "./ClassroomView";
import { PresentHeader } from "./PresentHeader";
import { useDisplayName } from "./useDisplayName";

/**
 * Phase 2.5: lets a teacher look at any lesson outside the live school
 * day - after hours, weekends, a future date - by picking a date and
 * class section directly instead of letting the schedule engine derive
 * them from the wall clock. `block` is optional real schedule context
 * (see `PresentScreen`'s block-matching) purely for an accurate period
 * label; it never drives which lesson is shown - `date` + `classSectionId`
 * do, via `resolvePreviewClassroomProps`, which uses the same
 * `findLessonForSection` lookup Live Mode uses.
 *
 * Renders through the exact same `ClassroomView` Live Mode uses (see
 * `LivePresentScreen`); `resolvePreviewClassroomProps` hardcodes the
 * countdown off, since Preview Mode has no live clock to count down from.
 */
export function PreviewPresentScreen({
  date,
  classSectionId,
  block,
  onCurrentLessonChange,
}: {
  date: string;
  classSectionId: string | null;
  block: ResolvedScheduleBlock | null;
  onCurrentLessonChange?: (lesson: DailyLesson | null) => void;
}) {
  const { data } = useAppData();
  const displayName = useDisplayName(classSectionId);
  const classroomProps = resolvePreviewClassroomProps({ date, classSectionId, block, lessons: data.lessons });

  useEffect(() => {
    onCurrentLessonChange?.(classroomProps?.lesson ?? null);
  }, [classroomProps, onCurrentLessonChange]);

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-falcon-brown-950">
      <PresentHeader now={new Date()} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} />

      <div className="px-10 pt-2 text-center sm:px-16">
        <span className="inline-block rounded-full border border-falcon-gold-500/50 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-falcon-gold-400">
          Preview · {formatDateKeyLong(date)}
        </span>
      </div>

      {!classroomProps ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-10 text-center">
          <p className="text-2xl font-bold text-falcon-cream-100">Choose a class section to preview.</p>
        </div>
      ) : (
        <ClassroomView displayName={displayName} {...classroomProps} />
      )}
    </div>
  );
}
