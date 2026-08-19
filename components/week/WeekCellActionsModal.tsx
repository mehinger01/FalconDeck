"use client";

import { useRouter } from "next/navigation";
import { useAppData } from "@/lib/store/AppDataProvider";
import { CopyLessonPanel } from "@/components/lessons/CopyLessonPanel";
import { findLessonForSection } from "@/lib/data/lessons";
import { addDaysToDateKey, formatDateKeyLong } from "@/lib/schedule/localDate";
import { buildLessonEditUrl, buildPreviewUrl } from "@/lib/week/weekLinks";
import type { WeekCell } from "@/lib/week/buildWeekPlanningGrid";
import type { ClassSection, Course } from "@/types/course";

/**
 * The "compact action surface" a Week cell click opens - a small centered
 * dialog rather than a table-anchored popover, so it never fights with the
 * grid's horizontal scroll/overflow clipping. Every action here either
 * navigates to an existing route (`/lessons`, `/present?mode=preview`) or
 * reuses an existing lesson action/component - nothing here reimplements
 * lesson editing, previewing, or copying.
 */
export function WeekCellActionsModal({
  cell,
  classSection,
  course,
  onClose,
}: {
  cell: WeekCell;
  classSection: ClassSection;
  course: Course | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { data, actions } = useAppData();

  const previousDate = addDaysToDateKey(cell.date, -1);
  const previousLesson = findLessonForSection(data.lessons, previousDate, cell.classSectionId);

  function goToEdit() {
    router.push(buildLessonEditUrl(cell.date, cell.classSectionId));
  }

  function goToPreview() {
    router.push(buildPreviewUrl(cell.date, cell.classSectionId, cell.scheduledBlockId));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-falcon-brown-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-falcon-cream-100 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-falcon-brown-700/70">
              {formatDateKeyLong(cell.date)}
            </p>
            <h2 className="text-lg font-bold text-falcon-brown-900">{classSection.name}</h2>
            {course && <p className="text-sm text-falcon-brown-700/70">{course.name}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-falcon-brown-700/60 hover:bg-falcon-brown-700/10"
          >
            ✕
          </button>
        </div>

        {cell.lesson ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={goToEdit}
                className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
              >
                Edit Lesson
              </button>
              <button
                type="button"
                onClick={goToPreview}
                className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/30"
              >
                Preview
              </button>
            </div>

            <CopyLessonPanel lesson={cell.lesson} />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  actions.createLesson(cell.date, cell.classSectionId);
                  onClose();
                }}
                className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
              >
                Create Lesson
              </button>
              <button
                type="button"
                onClick={() => {
                  actions.createLesson(cell.date, cell.classSectionId);
                  goToEdit();
                }}
                className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/30"
              >
                Create &amp; Edit
              </button>
            </div>

            {previousLesson && (
              <button
                type="button"
                onClick={() => {
                  actions.copyLessonToSection(previousLesson.id, cell.classSectionId, cell.date);
                  onClose();
                }}
                className="w-full rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/30"
              >
                Copy Previous Day
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
