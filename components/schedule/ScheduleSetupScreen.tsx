"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAppData } from "@/lib/store/AppDataProvider";
import { dataRepository, saveDefaultScheduleSelection } from "@/lib/data/localStorageRepository";
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
  const pathname = usePathname();
  const isDemo = pathname.startsWith("/demo");
  const defaultId = data.schedules.find((s) => s.isDefault)?.id ?? data.schedules[0]?.id ?? null;
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(defaultId);
  const [manualSaveState, setManualSaveState] = useState<
    { status: "idle" | "saving" | "saved" | "error"; message: string }
  >({ status: "idle", message: "" });

  const selectedSchedule =
    data.schedules.find((s) => s.id === selectedScheduleId) ?? data.schedules[0] ?? null;
  const isEditable = selectedSchedule ? selectedSchedule.source !== "built-in" : false;

  async function saveScheduleNow() {
    if (isDemo) return;

    const currentDefault = data.schedules.find((schedule) => schedule.isDefault);
    if (!currentDefault) {
      setManualSaveState({ status: "error", message: "Choose a default schedule before saving." });
      return;
    }

    setManualSaveState({ status: "saving", message: "Saving schedule…" });

    const appDataResult = await dataRepository.save(data);
    if (!appDataResult.ok) {
      setManualSaveState({
        status: "error",
        message: appDataResult.message || "Schedule could not be saved.",
      });
      return;
    }

    const defaultResult = saveDefaultScheduleSelection(currentDefault.id);
    if (!defaultResult.ok) {
      setManualSaveState({
        status: "error",
        message: defaultResult.message || "Default schedule choice could not be saved.",
      });
      return;
    }

    const verification = await dataRepository.load();
    const verifiedDefault = verification.schedules.find((schedule) => schedule.isDefault);
    if (verifiedDefault?.id !== currentDefault.id) {
      setManualSaveState({
        status: "error",
        message: "Falcon Deck could not verify the saved default schedule. Please try again.",
      });
      return;
    }

    setManualSaveState({
      status: "saved",
      message: `${currentDefault.name} saved as your default.`,
    });
  }

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

          <div className="flex flex-col items-end gap-2">
            {!isDemo && (
              <button
                type="button"
                onClick={saveScheduleNow}
                disabled={manualSaveState.status === "saving"}
                className="rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-bold text-falcon-cream-100 shadow-sm hover:bg-falcon-brown-800 disabled:cursor-wait disabled:opacity-60"
              >
                {manualSaveState.status === "saving" ? "Saving…" : "Save Schedule"}
              </button>
            )}

            {manualSaveState.status !== "idle" ? (
              <div
                role="status"
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  manualSaveState.status === "error"
                    ? "border-red-700/30 bg-red-50 text-red-900"
                    : manualSaveState.status === "saving"
                      ? "border-amber-600/30 bg-amber-50 text-amber-900"
                      : "border-green-700/25 bg-green-50 text-green-900"
                }`}
              >
                {manualSaveState.message}
              </div>
            ) : (
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
                  ? `Autosave failed: ${persistence.error ?? "browser storage rejected the change"}`
                  : persistence.status === "saving"
                    ? "Autosaving…"
                    : persistence.status === "saved"
                      ? "Autosaved"
                      : "Ready"}
              </div>
            )}
          </div>
        </div>

        {manualSaveState.status === "error" && (
          <p className="mt-2 rounded-lg border border-red-700/20 bg-red-50 p-3 text-sm text-red-900">
            Manual save failed: {manualSaveState.message}
          </p>
        )}
        {manualSaveState.status === "saved" && (
          <p className="mt-2 rounded-lg border border-green-700/20 bg-green-50 p-3 text-sm text-green-900">
            Your chosen default schedule was written separately and verified by reloading it from browser storage.
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
