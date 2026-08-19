"use client";

import type { WeekCell as WeekCellData } from "@/lib/week/buildWeekPlanningGrid";

const STATUS_CLASSES: Record<WeekCellData["status"], string> = {
  missing: "border-dashed border-falcon-brown-700/25 bg-falcon-cream-100/50 text-falcon-brown-700/50",
  draft: "border-falcon-gold-500/50 bg-falcon-gold-300/10 text-falcon-brown-800",
  prepared: "border-falcon-brown-700/20 bg-white text-falcon-brown-900",
};

function CellSummary({ cell }: { cell: WeekCellData }) {
  if (cell.status === "missing") {
    return <span className="text-xs font-semibold">+ Add Lesson</span>;
  }

  if (cell.status === "draft") {
    return <span className="text-xs font-bold uppercase tracking-wide text-falcon-gold-600">Draft</span>;
  }

  // "prepared" - cell.lesson is guaranteed non-null (status is derived from it).
  const lesson = cell.lesson!;
  const target = lesson.learningTarget.trim();
  const counts = [
    lesson.agendaItems.length > 0 ? `${lesson.agendaItems.length} agenda` : null,
    lesson.resources.length > 0
      ? `${lesson.resources.length} resource${lesson.resources.length === 1 ? "" : "s"}`
      : null,
    lesson.announcements.length > 0
      ? `${lesson.announcements.length} note${lesson.announcements.length === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return (
    <div className="flex w-full flex-col gap-1">
      {target && <p className="line-clamp-2 text-xs font-semibold">{target}</p>}
      {counts.length > 0 && (
        <p className="text-[11px] text-falcon-brown-700/60">{counts.join(" · ")}</p>
      )}
      {cell.agendaCompletion && (
        <p className="text-[11px] font-semibold text-falcon-gold-600">
          {cell.agendaCompletion.completed}/{cell.agendaCompletion.total} agenda items complete
        </p>
      )}
    </div>
  );
}

/** One Week grid cell: a click target that opens `WeekCellActionsModal` for this date/section. */
export function WeekCell({
  cell,
  isToday,
  onOpen,
}: {
  cell: WeekCellData;
  isToday: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex h-full min-h-[5.5rem] w-full flex-col items-start justify-start gap-1 rounded-lg border p-2 text-left transition-colors hover:border-falcon-gold-500 ${
        STATUS_CLASSES[cell.status]
      } ${isToday ? "ring-2 ring-falcon-gold-400/70 ring-offset-1 ring-offset-falcon-cream-200" : ""} ${
        cell.scheduledBlockId === null ? "opacity-70" : ""
      }`}
    >
      <CellSummary cell={cell} />
    </button>
  );
}
