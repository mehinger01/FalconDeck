"use client";

import { useState } from "react";
import type { BlockKind, ScheduleBlock, ScheduleBlockOverride, Weekday } from "@/types/schedule";
import { ClassSectionSelect } from "./ClassSectionSelect";
import { KindSelect } from "./KindSelect";

/** Inline form for creating or editing a single weekday override on a block. */
export function OverrideForm({
  block,
  weekday,
  existing,
  onSave,
  onCancel,
}: {
  block: ScheduleBlock;
  weekday: Weekday;
  existing?: ScheduleBlockOverride;
  onSave: (override: Omit<ScheduleBlockOverride, "id"> & { id?: string }) => void;
  onCancel: () => void;
}) {
  const [overrideLabel, setOverrideLabel] = useState(existing?.label !== undefined);
  const [label, setLabel] = useState(existing?.label ?? block.label);

  const [overrideKind, setOverrideKind] = useState(existing?.kind !== undefined);
  const [kind, setKind] = useState<BlockKind>(existing?.kind ?? block.kind);
  const [customKindLabel, setCustomKindLabel] = useState(
    existing?.customKindLabel ?? block.customKindLabel ?? "",
  );

  const [overrideClass, setOverrideClass] = useState(
    existing ? "classSectionId" in existing : false,
  );
  const [classSectionId, setClassSectionId] = useState<string | null>(
    existing?.classSectionId ?? block.classSectionId ?? null,
  );

  const [overrideTime, setOverrideTime] = useState(
    existing?.startTime !== undefined || existing?.endTime !== undefined,
  );
  const [startTime, setStartTime] = useState(existing?.startTime ?? block.startTime);
  const [endTime, setEndTime] = useState(existing?.endTime ?? block.endTime);

  function handleSave() {
    const override: Omit<ScheduleBlockOverride, "id"> & { id?: string } = { weekday };
    if (existing) override.id = existing.id;
    if (overrideLabel) override.label = label;
    if (overrideKind) {
      override.kind = kind;
      if (kind === "custom") override.customKindLabel = customKindLabel;
    }
    if (overrideClass) override.classSectionId = classSectionId;
    if (overrideTime) {
      override.startTime = startTime;
      override.endTime = endTime;
    }
    onSave(override);
  }

  const weekdayLabel = weekday.charAt(0).toUpperCase() + weekday.slice(1);

  return (
    <div className="mt-2 rounded-lg border border-falcon-gold-500/40 bg-falcon-gold-300/10 p-3">
      <p className="mb-2 text-sm font-semibold text-falcon-brown-900">
        Override for {weekdayLabel}
      </p>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-falcon-brown-800">
          <input
            type="checkbox"
            checked={overrideLabel}
            onChange={(e) => setOverrideLabel(e.target.checked)}
          />
          Override label
          {overrideLabel && (
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="ml-1 flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1 text-sm"
            />
          )}
        </label>

        <label className="flex items-center gap-2 text-sm text-falcon-brown-800">
          <input
            type="checkbox"
            checked={overrideKind}
            onChange={(e) => setOverrideKind(e.target.checked)}
          />
          Override kind
        </label>
        {overrideKind && (
          <div className="ml-6 flex items-center gap-2">
            <KindSelect value={kind} onChange={setKind} />
            {kind === "custom" && (
              <input
                value={customKindLabel}
                onChange={(e) => setCustomKindLabel(e.target.value)}
                placeholder="Custom label"
                className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1 text-sm"
              />
            )}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-falcon-brown-800">
          <input
            type="checkbox"
            checked={overrideClass}
            onChange={(e) => setOverrideClass(e.target.checked)}
          />
          Override assigned class
        </label>
        {overrideClass && (
          <div className="ml-6">
            <ClassSectionSelect value={classSectionId} onChange={setClassSectionId} />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-falcon-brown-800">
          <input
            type="checkbox"
            checked={overrideTime}
            onChange={(e) => setOverrideTime(e.target.checked)}
          />
          Override start/end time
        </label>
        {overrideTime && (
          <div className="ml-6 flex items-center gap-2">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1 text-sm"
            />
            <span className="text-falcon-brown-700">to</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1 text-sm"
            />
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
        >
          Save Override
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-falcon-brown-700 hover:bg-falcon-brown-700/10"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
