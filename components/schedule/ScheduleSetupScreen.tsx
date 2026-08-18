"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { validateSchedule } from "@/lib/schedule/validateSchedule";
import { BlockList } from "./BlockList";
import { ScheduleList } from "./ScheduleList";
import { ValidationBanner } from "./ValidationBanner";

export function ScheduleSetupScreen() {
  const { data, actions } = useAppData();
  const defaultId = data.schedules.find((s) => s.isDefault)?.id ?? data.schedules[0]?.id ?? null;
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(defaultId);

  const selectedSchedule =
    data.schedules.find((s) => s.id === selectedScheduleId) ?? data.schedules[0] ?? null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Schedule Setup</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Build bell schedules from scratch — any number of blocks, any lengths, any order.
          Placeholder demo data is seeded below; edit or replace it freely.
        </p>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row">
        <ScheduleList
          selectedScheduleId={selectedSchedule?.id ?? null}
          onSelect={setSelectedScheduleId}
        />

        <div className="min-w-0 flex-1">
          {selectedSchedule ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-falcon-brown-700/70">Name</span>
                  <input
                    value={selectedSchedule.name}
                    onChange={(e) =>
                      actions.renameSchedule(selectedSchedule.id, e.target.value)
                    }
                    className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm font-semibold"
                  />
                </label>
                {selectedSchedule.description && (
                  <p className="text-xs italic text-falcon-brown-700/60">
                    {selectedSchedule.description}
                  </p>
                )}
              </div>

              <ValidationBanner issues={validateSchedule(selectedSchedule)} />
              <BlockList schedule={selectedSchedule} />
            </>
          ) : (
            <p className="text-sm text-falcon-brown-700/60">
              No schedules yet — create one to get started.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
