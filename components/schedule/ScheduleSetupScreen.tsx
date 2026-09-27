"use client";

import { useState } from "react";
import { useAppData, useActiveSchedule } from "@/lib/store/AppDataProvider";
import { validateSchedule } from "@/lib/schedule/validateSchedule";
import { BellScheduleImportPanel } from "./BellScheduleImportPanel";
import { BlockList } from "./BlockList";
import { BuiltInScheduleSummary } from "./BuiltInScheduleSummary";
import { MyScheduleSection } from "./MyScheduleSection";
import { ScheduleList } from "./ScheduleList";
import { ScheduleSectionTabs } from "./ScheduleSectionTabs";
import { SharedScheduleAssignmentView } from "./SharedScheduleAssignmentView";
import { ValidationBanner } from "./ValidationBanner";

export function ScheduleSetupScreen() {
  const { data, actions } = useAppData();
  const activeSchedule = useActiveSchedule();
  // The right-hand panel's "which schedule am I looking at" state - a
  // teacher may browse any schedule they can see (including a shared one,
  // read-only) without that changing which schedule is active. Defaults to
  // the active schedule when one exists, purely as a starting point for
  // this local view-state - never re-derived from isDefault/schedules[0].
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(
    activeSchedule?.id ?? data.schedules[0]?.id ?? null,
  );

  const selectedSchedule =
    data.schedules.find((s) => s.id === selectedScheduleId) ?? data.schedules[0] ?? null;
  const isEditable = selectedSchedule
    ? selectedSchedule.ownerType === "teacher" && selectedSchedule.source !== "built-in"
    : false;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Schedule Setup</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Bell schedules define when each block happens. The Master Calendar (separate tab) decides
          which schedule applies on which date. Use the list on the left to choose your active
          schedule - shared school schedules are read-only; your own schedules are fully editable.
        </p>
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
          onSelect={(scheduleId) => setSelectedScheduleId(scheduleId)}
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
                {selectedSchedule.ownerType === "organization" && (
                  <span className="rounded-full bg-falcon-brown-700/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-falcon-brown-800">
                    Shared - read only
                  </span>
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
              ) : selectedSchedule.ownerType === "organization" &&
                !selectedSchedule.needsConfiguration &&
                selectedSchedule.blocks.length > 0 ? (
                // Stage E: a configured shared schedule gets the
                // class-assignment view instead of the plain read-only
                // summary - an unconfigured one (or any teacher-owned
                // built-in) still falls through to BuiltInScheduleSummary
                // below, unchanged.
                <SharedScheduleAssignmentView schedule={selectedSchedule} />
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
