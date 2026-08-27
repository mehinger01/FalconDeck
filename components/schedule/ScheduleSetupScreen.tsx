"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { validateSchedule } from "@/lib/schedule/validateSchedule";
import { BellScheduleImportPanel } from "./BellScheduleImportPanel";
import { BlockList } from "./BlockList";
import { BuiltInScheduleSummary } from "./BuiltInScheduleSummary";
import { MyScheduleSection } from "./MyScheduleSection";
import { ScheduleList } from "./ScheduleList";
import { ScheduleSectionTabs } from "./ScheduleSectionTabs";
import { ValidationBanner } from "./ValidationBanner";

export function ScheduleSetupScreen() {
  const { data, actions, persistence } = useAppData();
  const defaultId = data.schedules.find((s) => s.isDefault)?.id ?? data.schedules[0]?.id ?? null;
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(defaultId);

  const selectedSchedule =
    data.schedules.find((s) => s.id === selectedScheduleId) ?? data.schedules[0] ?? null;
  const isEditable = selectedSchedule ? selectedSchedule.source !== "built-in" : false;

  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-falcon-brown-900">Schedule Setup</h1>
            <p className="mt-1 text-sm text-falcon-brown-700/70">
              Bell schedules define when each block happens. The Master Calendar (separate tab) decides
              which schedule applies on which date.
            </p>
          </div>
          <div
            role="status"
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              persistence.status === "error"
                ? "border-red-700/30 bg-red-50 text-red-900"
                : persistence.status === "saving"
                  ? "border-amber-600/30 bg-amber-50 text-amber-900"
                  : persistence.status === "saved"
                    ? "border-green-700/25 bg-green-50 text-green-900"
                    : "border-falcon-brown-700/20 bg-white/50 text-falcon-brown-700/70"
            }`}
          >
            {persistence.status === "error"
              ? `Save failed: ${persistence.error ?? "browser storage rejected the change"}`
              : persistence.status === "saving"
                ? "Saving…"
                : persistence.status === "saved"
                  ? "Saved"
                  : "Ready"}
          </div>
        </div>
        {persistence.status === "error" && (
          <p className="mt-2 rounded-lg border border-red-700/20 bg-red-50 p-3 text-sm text-red-900">
            Falcon Deck changed the schedule on screen, but your browser did not persist it. Do not leave
            this page assuming the change is saved. The message above identifies the storage failure so it
            can be corrected instead of silently reverting later.
          </p>
        )}
      </div>

      <ScheduleSectionTabs />

      <div className="mb-6">
        <MyScheduleSection />
      </div>

      <div className="mb-4 flex justify-end">
        <BellScheduleImportPanel />
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
                {isEditable ? (
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-falcon-brown-700/70">Name</span>
                    <input
                      value={selectedSchedule.name}
                      onChange={(e) => actions.renameSchedule(selectedSchedule.id, e.target.value)}
                      className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm font-semibold text-falcon-brown-900"
                    />
                  </label>
                ) : (
                  <h2 className="text-lg font-bold text-falcon-brown-900">{selectedSchedule.name}</h2>
                )}
                {selectedSchedule.description && (
                  <p className="text-xs italic text-falcon-brown-700/60">{selectedSchedule.description}</p>
                )}
              </div>

              {isEditable ? (
                <>
                  <ValidationBanner issues={validateSchedule(selectedSchedule)} />
                  <BlockList schedule={selectedSchedule} />
                </>
              ) : (
                <BuiltInScheduleSummary schedule={selectedSchedule} />
              )}
            </>
          ) : (
            <p className="text-sm text-falcon-brown-700/60">
              No schedules yet — create one, import one, or add OHHS Regular Day to get started.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
