"use client";

import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import type { DailyLesson, LessonResource } from "@/types/lesson";

/**
 * Lists resources already attached to the current `DailyLesson` - Phase 4
 * only ever launches resources that are already on the lesson (no global
 * resource library yet). Selecting one opens `ResourceOverlay`.
 */
export function QuickResourcePanel({
  lesson,
  onSelect,
}: {
  lesson: DailyLesson | null;
  onSelect: (resource: LessonResource) => void;
}) {
  if (!lesson || lesson.resources.length === 0) {
    return (
      <p className="text-xs text-falcon-cream-200/60">
        No resources on the current lesson yet - add some from the Lessons screen.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {lesson.resources.map((resource) => (
        <li key={resource.id}>
          <button
            type="button"
            onClick={() => onSelect(resource)}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-falcon-cream-200/20 px-2.5 py-1.5 text-left text-sm text-falcon-cream-100 hover:bg-falcon-cream-200/10"
          >
            <span className="truncate">{resource.title}</span>
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-falcon-gold-400">
              {RESOURCE_TYPE_LABELS[resource.type]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
