"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { ScheduleSectionTabs } from "@/components/schedule/ScheduleSectionTabs";
import { buildMasterCalendarCsvTemplate } from "@/lib/calendar/masterCalendarImport";
import type { SchoolCalendarException } from "@/types/calendar";
import { CalendarExceptionForm } from "./CalendarExceptionForm";
import { MasterCalendarImportPanel } from "./MasterCalendarImportPanel";

function downloadCsvTemplate() {
  const blob = new Blob([buildMasterCalendarCsvTemplate()], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "falcon-deck-master-calendar-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

const TYPE_LABELS: Record<SchoolCalendarException["type"], string> = {
  "no-school": "No School",
  "no-students": "No Students",
  "special-bell": "Special Bell",
};

export function MasterCalendarScreen() {
  const { data, actions } = useAppData();
  const calendar = data.schoolCalendar;
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const unconfiguredProfiles = data.schedules.filter((s) => s.needsConfiguration);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Master Calendar</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Decides whether students attend today, and which Bell Schedule applies - Present Mode reads
          this automatically every day.
        </p>
      </div>

      <ScheduleSectionTabs />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <MasterCalendarImportPanel />
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-700 hover:bg-falcon-cream-100"
        >
          Add Exception
        </button>
        <button
          type="button"
          onClick={downloadCsvTemplate}
          className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-700 hover:bg-falcon-cream-100"
        >
          Download CSV Template
        </button>
      </div>

      {editing === "new" && (
        <div className="mb-4">
          <CalendarExceptionForm onDone={() => setEditing(null)} />
        </div>
      )}

      {calendar ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryStat label="School Year" value={calendar.schoolYear || "—"} />
          <SummaryStat label="First Student Day" value={calendar.firstStudentDay || "—"} />
          <SummaryStat label="Last Student Day" value={calendar.lastStudentDay || "—"} />
          <SummaryStat
            label="Default Bell Schedule"
            value={data.schedules.find((s) => s.id === calendar.defaultBellScheduleId)?.name ?? "Not mapped"}
          />
          <SummaryStat label="Exceptions" value={String(calendar.exceptions.length)} />
          <SummaryStat label="Unconfigured Profiles" value={String(unconfiguredProfiles.length)} />
        </div>
      ) : (
        <p className="mb-6 rounded-lg border border-dashed border-falcon-brown-700/30 bg-white/50 p-6 text-center text-sm text-falcon-brown-700/60">
          No Master Calendar imported yet. Present Mode will use your default Bell Schedule every school
          day until you import one.
        </p>
      )}

      {unconfiguredProfiles.length > 0 && (
        <p className="mb-4 rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-900">
          {unconfiguredProfiles.length} special schedule{unconfiguredProfiles.length === 1 ? "" : "s"} need
          configuration: {unconfiguredProfiles.map((s) => s.name).join(", ")} - visit Bell Schedules to add
          their block times.
        </p>
      )}

      {calendar && calendar.exceptions.length > 0 && (
        <ul className="space-y-2">
          {[...calendar.exceptions]
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map((exception) =>
              editing === exception.id ? (
                <li key={exception.id}>
                  <CalendarExceptionForm existing={exception} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li
                  key={exception.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-falcon-brown-700/15 bg-white/60 px-4 py-2.5"
                >
                  <div>
                    <span className="font-semibold text-falcon-brown-900">{exception.title}</span>
                    <span className="ml-2 rounded-full bg-falcon-brown-700/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-falcon-brown-700">
                      {TYPE_LABELS[exception.type]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-falcon-brown-700/70">
                      {exception.startDate}
                      {exception.endDate !== exception.startDate ? ` – ${exception.endDate}` : ""}
                      {exception.dismissalTime ? ` · dismissal ${exception.dismissalTime}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditing(exception.id)}
                      className="font-medium text-falcon-brown-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => actions.deleteCalendarException(exception.id)}
                      className="font-medium text-red-800 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ),
            )}
        </ul>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3">
      <p className="text-xs text-falcon-brown-700/60">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-falcon-brown-900">{value}</p>
    </div>
  );
}
