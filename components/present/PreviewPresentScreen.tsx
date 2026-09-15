"use client";

import { useEffect, useMemo, useRef } from "react";
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

  // Memoized because `resolvePreviewClassroomProps` builds a brand-new
  // wrapper object on every call, even when `date`/`classSectionId`/
  // `block`/`data.lessons` haven't actually changed. Without this, every
  // unrelated re-render (a clock tick, a tool-tray toggle, anything) would
  // produce a "new" `classroomProps`/`lesson` reference, and any effect or
  // memoized child depending on it would re-fire needlessly - or loop, if
  // that effect also calls a state setter.
  const classroomProps = useMemo(
    () => resolvePreviewClassroomProps({ date, classSectionId, block, lessons: data.lessons }),
    [date, classSectionId, block, data.lessons],
  );
  const lesson = classroomProps?.lesson ?? null;
  const lessonId = lesson?.id ?? null;

  // Belt-and-suspenders against a render loop: the primitive `lessonId`
  // dependency already keeps this effect from re-firing on reference-only
  // churn (matching `LivePresentScreen`'s equivalent effect, which depends
  // on the lesson value itself rather than a wrapper), and the ref guard
  // additionally ensures `onCurrentLessonChange` is never called twice in a
  // row for the same lesson even if this effect is re-invoked for an
  // unrelated reason.
  const notifiedLessonIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (notifiedLessonIdRef.current === lessonId) return;
    notifiedLessonIdRef.current = lessonId;
    onCurrentLessonChange?.(lesson);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, onCurrentLessonChange]);

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
