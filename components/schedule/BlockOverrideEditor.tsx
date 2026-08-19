"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { WEEKDAYS, type ScheduleBlock, type ScheduleBlockOverride, type Weekday } from "@/types/schedule";
import { OverrideForm } from "./OverrideForm";

function summarizeOverride(override: ScheduleBlockOverride): string {
  const parts: string[] = [];
  if (override.label !== undefined) parts.push(`label → "${override.label}"`);
  if (override.kind !== undefined) parts.push(`kind → ${override.kind}`);
  if ("classSectionId" in override) {
    parts.push(override.classSectionId ? "class reassigned" : "class unassigned");
  }
  if (override.startTime !== undefined || override.endTime !== undefined) parts.push("time changed");
  return parts.length > 0 ? parts.join(", ") : "no changes";
}

export function BlockOverrideEditor({
  scheduleId,
  block,
}: {
  scheduleId: string;
  block: ScheduleBlock;
}) {
  const { actions } = useAppData();
  const [activeWeekday, setActiveWeekday] = useState<Weekday | null>(null);
  const [pickerWeekday, setPickerWeekday] = useState<Weekday | "">("");

  const overriddenWeekdays = new Set(block.overrides.map((o) => o.weekday));
  const availableWeekdays = WEEKDAYS.filter((day) => !overriddenWeekdays.has(day));

  return (
    <div className="mt-3 border-t border-falcon-brown-700/15 pt-3">
      <p className="text-xs font-bold uppercase tracking-wide text-falcon-brown-700/70">
        Weekday Overrides
      </p>

      {block.overrides.length === 0 && activeWeekday === null && (
        <p className="mt-1 text-sm text-falcon-brown-700/60">
          No overrides — this block is the same every school day.
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {block.overrides.map((override) =>
          activeWeekday === override.weekday ? (
            <li key={override.weekday}>
              <OverrideForm
                block={block}
                weekday={override.weekday}
                existing={override}
                onSave={(patch) => {
                  actions.setBlockOverride(scheduleId, block.id, patch);
                  setActiveWeekday(null);
                }}
                onCancel={() => setActiveWeekday(null)}
              />
              <button
                type="button"
                onClick={() => {
                  actions.removeBlockOverride(scheduleId, block.id, override.weekday);
                  setActiveWeekday(null);
                }}
                className="mt-2 text-xs font-medium text-red-800 hover:underline"
              >
                Remove this override
              </button>
            </li>
          ) : (
            <li
              key={override.weekday}
              className="flex items-center justify-between rounded-md bg-falcon-brown-700/5 px-2 py-1 text-sm"
            >
              <span>
                <span className="font-semibold capitalize">{override.weekday}</span>:{" "}
                {summarizeOverride(override)}
              </span>
              <button
                type="button"
                onClick={() => setActiveWeekday(override.weekday)}
                className="text-xs font-medium text-falcon-brown-700 hover:underline"
              >
                Edit
              </button>
            </li>
          ),
        )}
      </ul>

      {activeWeekday && !overriddenWeekdays.has(activeWeekday) && (
        <OverrideForm
          block={block}
          weekday={activeWeekday}
          onSave={(patch) => {
            actions.setBlockOverride(scheduleId, block.id, patch);
            setActiveWeekday(null);
          }}
          onCancel={() => setActiveWeekday(null)}
        />
      )}

      {availableWeekdays.length > 0 && activeWeekday === null && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={pickerWeekday}
            onChange={(e) => setPickerWeekday(e.target.value as Weekday | "")}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1 text-sm text-falcon-brown-900"
          >
            <option value="">Choose a weekday…</option>
            {availableWeekdays.map((day) => (
              <option key={day} value={day} className="capitalize">
                {day.charAt(0).toUpperCase() + day.slice(1)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pickerWeekday}
            onClick={() => {
              if (!pickerWeekday) return;
              setActiveWeekday(pickerWeekday);
              setPickerWeekday("");
            }}
            className="rounded-md bg-falcon-gold-500 px-3 py-1 text-sm font-semibold text-falcon-brown-950 disabled:opacity-40"
          >
            + Add Override
          </button>
        </div>
      )}
    </div>
  );
}
