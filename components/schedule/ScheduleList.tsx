"use client";

import { useState } from "react";
import { useAppData, useActiveSchedule } from "@/lib/store/AppDataProvider";
import { createOhhsRegularSchedule, OHHS_REGULAR_ID } from "@/lib/schedule/presets/ohhsRegular";
import { formatTimeString } from "@/lib/schedule/time";
import type { BellSchedule } from "@/types/schedule";

function ScheduleSummary({ schedule }: { schedule: BellSchedule }) {
  const startTime = schedule.blocks[0]?.startTime;
  const endTime = schedule.blocks[schedule.blocks.length - 1]?.endTime;
  return (
    <span className="block text-xs text-falcon-brown-700/60">
      {schedule.blocks.length} block{schedule.blocks.length === 1 ? "" : "s"}
      {startTime && endTime && (
        <>
          {" "}
          · {formatTimeString(startTime)} – {formatTimeString(endTime)}
        </>
      )}
    </span>
  );
}

/**
 * Shared/private schedule selector and (for the teacher's own schedules
 * only) rename/duplicate/delete entry points. `selectedScheduleId`/`onSelect`
 * are about which schedule's blocks are shown for VIEWING in
 * ScheduleSetupScreen's right-hand panel - a distinct concept from "active"
 * (which schedule Present Mode/Week View actually use, resolved solely via
 * teacherSchedulePreferences.activeBellScheduleId - see
 * lib/schedule/resolveActiveSchedule.ts). A teacher can browse any schedule
 * they can see without making it active.
 */
export function ScheduleList({
  selectedScheduleId,
  onSelect,
}: {
  selectedScheduleId: string | null;
  onSelect: (scheduleId: string) => void;
}) {
  const { data, actions } = useAppData();
  const activeSchedule = useActiveSchedule();
  const [newName, setNewName] = useState("");
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState<string | null>(null);
  const hasOhhsRegular = data.schedules.some((s) => s.id === OHHS_REGULAR_ID);

  // Organization-owned schedules are already fully readable here (RLS
  // already returns them alongside the teacher's own - see
  // lib/data/supabaseDataRepository.ts's fetchAppData) - this is purely a
  // display grouping, not a new data-fetching concern.
  const sharedSchedules = data.schedules.filter((s) => s.ownerType === "organization");
  const yourSchedules = data.schedules.filter((s) => s.ownerType === "teacher");

  function handleDelete(schedule: BellSchedule) {
    if (activeSchedule?.id === schedule.id) {
      // Mirrors the reducer's own DELETE_SCHEDULE guard (Architecture
      // Decision #3): never silently unselect or reassign the active
      // schedule by deleting it. Surfaced here, before dispatch, so the
      // teacher actually sees why nothing happened.
      setDeleteBlockedMessage(
        `Can't delete "${schedule.name}" - it's your active schedule. Choose a different one to use first.`,
      );
      return;
    }
    setDeleteBlockedMessage(null);
    actions.deleteSchedule(schedule.id);
  }

  function renderRow(schedule: BellSchedule, { editable }: { editable: boolean }) {
    const isActive = activeSchedule?.id === schedule.id;
    const isBuiltIn = schedule.source === "built-in";
    return (
      <li
        key={schedule.id}
        className={`rounded-lg border p-3 ${
          selectedScheduleId === schedule.id
            ? "border-falcon-gold-500 bg-falcon-gold-300/15"
            : "border-falcon-brown-700/15 bg-white/50"
        }`}
      >
        <button type="button" onClick={() => onSelect(schedule.id)} className="block w-full text-left">
          <span className="flex flex-wrap items-center gap-1.5 font-semibold text-falcon-brown-900">
            {schedule.name}
            {/* "Recommended" means the school admin's designated shared
                default - it must NEVER appear for a teacher-owned schedule,
                even one carrying a legacy isDefault:true (a private,
                non-authoritative bookkeeping flag for teacher-owned rows -
                see BellSchedule.isDefault's own doc comment). A teacher's
                own active/in-use state is shown separately below, driven
                only by activeSchedule?.id === schedule.id, never isDefault. */}
            {schedule.ownerType === "organization" && schedule.isDefault && (
              <span className="rounded-full bg-falcon-gold-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-falcon-brown-950">
                Recommended
              </span>
            )}
            {isBuiltIn && (
              <span className="rounded-full bg-falcon-brown-700/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-falcon-brown-800">
                Built-in
              </span>
            )}
            {schedule.needsConfiguration && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                Needs Configuration
              </span>
            )}
          </span>
          <ScheduleSummary schedule={schedule} />
        </button>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {isActive ? (
            <span className="font-semibold text-green-800">Currently in use</span>
          ) : (
            <button
              type="button"
              onClick={() => actions.setActiveBellSchedule(schedule.id)}
              className="font-medium text-falcon-brown-700 hover:underline"
            >
              Use this schedule
            </button>
          )}

          {/* Edit/rename/duplicate/delete: teacher-owned schedules only.
              An ordinary teacher never receives these controls for a
              shared schedule - "Copy shared schedule" is deliberately not
              built yet (Stage D scope). */}
          {editable && (
            <>
              <button
                type="button"
                onClick={() => actions.duplicateSchedule(schedule.id)}
                className="font-medium text-falcon-brown-700 hover:underline"
              >
                Duplicate
              </button>
              {!isBuiltIn && data.schedules.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleDelete(schedule)}
                  className="font-medium text-red-800 hover:underline"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="w-full shrink-0 sm:w-72">
      {deleteBlockedMessage && (
        <p role="alert" className="mb-3 rounded-md bg-red-100 px-3 py-2 text-xs text-red-900">
          {deleteBlockedMessage}
        </p>
      )}

      {sharedSchedules.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
            Shared School Schedules
          </h3>
          <ul className="space-y-2">{sharedSchedules.map((schedule) => renderRow(schedule, { editable: false }))}</ul>
        </div>
      )}

      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Your Schedules</h3>
      <ul className="space-y-2">{yourSchedules.map((schedule) => renderRow(schedule, { editable: true }))}</ul>

      {!hasOhhsRegular && (
        <button
          type="button"
          onClick={() => actions.addBuiltInSchedule(createOhhsRegularSchedule())}
          className="mt-3 w-full rounded-md border border-falcon-gold-500/60 bg-falcon-gold-300/10 px-3 py-2 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/25"
        >
          + Use OHHS Regular Day
        </button>
      )}

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
          className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
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
