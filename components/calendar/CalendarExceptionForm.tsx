"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { generateId } from "@/lib/store/id";
import type { SchoolCalendarException, SchoolDayExceptionType } from "@/types/calendar";

const TYPE_OPTIONS: { value: SchoolDayExceptionType; label: string }[] = [
  { value: "no-school", label: "No School" },
  { value: "no-students", label: "No Students" },
  { value: "special-bell", label: "Special Bell" },
];

/** Manual add/edit for a single calendar exception - no need to re-import the whole calendar to fix or add one date. */
export function CalendarExceptionForm({
  existing,
  onDone,
}: {
  existing?: SchoolCalendarException;
  onDone: () => void;
}) {
  const { data, actions } = useAppData();
  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [type, setType] = useState<SchoolDayExceptionType>(existing?.type ?? "no-school");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [bellScheduleId, setBellScheduleId] = useState(existing?.bellScheduleId ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  function handleSubmit() {
    if (!startDate || !title.trim()) return;
    const patch = {
      startDate,
      endDate: endDate || startDate,
      type,
      title: title.trim(),
      bellScheduleId: type === "special-bell" && bellScheduleId ? bellScheduleId : undefined,
      notes: notes.trim() || undefined,
    };
    if (existing) {
      actions.updateCalendarException(existing.id, patch);
    } else {
      actions.addCalendarException({ id: generateId("calendar-exception"), ...patch } satisfies SchoolCalendarException);
    }
    onDone();
  }

  return (
    <div className="rounded-lg border border-falcon-brown-700/20 bg-white/70 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Start date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">End date</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            placeholder={startDate}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as SchoolDayExceptionType)}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          />
        </label>
      </div>

      {type === "special-bell" && (
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Bell schedule</span>
          <select
            value={bellScheduleId}
            onChange={(e) => setBellScheduleId(e.target.value)}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          >
            <option value="">Choose a schedule…</option>
            {data.schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.name}
                {schedule.needsConfiguration ? " (Needs Configuration)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-semibold text-falcon-brown-700/70">Notes (optional)</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
        />
      </label>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!startDate || !title.trim()}
          className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {existing ? "Save Changes" : "Add Exception"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-700 hover:bg-falcon-cream-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
