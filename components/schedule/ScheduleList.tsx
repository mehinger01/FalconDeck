"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";

export function ScheduleList({
  selectedScheduleId,
  onSelect,
}: {
  selectedScheduleId: string | null;
  onSelect: (scheduleId: string) => void;
}) {
  const { data, actions } = useAppData();
  const [newName, setNewName] = useState("");

  return (
    <div className="w-full shrink-0 sm:w-72">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
        Schedules
      </h3>
      <ul className="space-y-2">
        {data.schedules.map((schedule) => (
          <li
            key={schedule.id}
            className={`rounded-lg border p-3 ${
              selectedScheduleId === schedule.id
                ? "border-falcon-gold-500 bg-falcon-gold-300/15"
                : "border-falcon-brown-700/15 bg-white/50"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(schedule.id)}
              className="block w-full text-left"
            >
              <span className="flex items-center gap-2 font-semibold text-falcon-brown-900">
                {schedule.name}
                {schedule.isDefault && (
                  <span className="rounded-full bg-falcon-gold-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-falcon-brown-950">
                    Default
                  </span>
                )}
              </span>
              <span className="text-xs text-falcon-brown-700/60">
                {schedule.blocks.length} block{schedule.blocks.length === 1 ? "" : "s"}
              </span>
            </button>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {!schedule.isDefault && (
                <button
                  type="button"
                  onClick={() => actions.setDefaultSchedule(schedule.id)}
                  className="font-medium text-falcon-brown-700 hover:underline"
                >
                  Set as default
                </button>
              )}
              <button
                type="button"
                onClick={() => actions.duplicateSchedule(schedule.id)}
                className="font-medium text-falcon-brown-700 hover:underline"
              >
                Duplicate
              </button>
              {data.schedules.length > 1 && (
                <button
                  type="button"
                  onClick={() => actions.deleteSchedule(schedule.id)}
                  className="font-medium text-red-800 hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return;
          actions.createSchedule(name);
          setNewName("");
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New schedule name"
          className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-falcon-gold-500 px-3 py-1.5 text-sm font-semibold text-falcon-brown-950"
        >
          Create
        </button>
      </form>
    </div>
  );
}
