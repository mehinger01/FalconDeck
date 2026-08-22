"use client";

import { useState, type ChangeEvent } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import {
  buildMasterCalendarImportPreview,
  commitMasterCalendarImport,
  parseMasterCalendarCsv,
  parseMasterCalendarJson,
  type CalendarConflictResolution,
  type CalendarImportMeta,
  type MasterCalendarImportPreview,
  type ParsedCalendarException,
} from "@/lib/calendar/masterCalendarImport";
import { generateId } from "@/lib/store/id";

type ImportStep =
  | { step: "closed" }
  | { step: "input"; text: string; issues: string[] }
  | { step: "preview"; meta: CalendarImportMeta | null; exceptions: ParsedCalendarException[]; preview: MasterCalendarImportPreview; conflictResolution: CalendarConflictResolution };

/**
 * File/paste -> parse -> validate -> preview (Resolve Schedule Profiles +
 * conflict detection happen inside buildMasterCalendarImportPreview) ->
 * confirm. Nothing here mutates AppData until "Confirm Import" - see
 * lib/calendar/masterCalendarImport.ts for the pure parse/preview/commit
 * pipeline this just drives.
 */
export function MasterCalendarImportPanel() {
  const { data, actions } = useAppData();
  const [state, setState] = useState<ImportStep>({ step: "closed" });

  if (state.step === "closed") {
    return (
      <button
        type="button"
        onClick={() => setState({ step: "input", text: "", issues: [] })}
        className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-falcon-brown-800"
      >
        Import Master Calendar
      </button>
    );
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text();
    setState({ step: "input", text, issues: [] });
  }

  function handleParse() {
    if (state.step !== "input") return;
    const trimmed = state.text.trim();
    const looksLikeJson = trimmed.startsWith("{");
    const result = looksLikeJson ? parseMasterCalendarJson(state.text) : parseMasterCalendarCsv(state.text);

    if (!result.ok) {
      setState({ step: "input", text: state.text, issues: result.issues.map((i) => `Row ${i.rowIndex}: ${i.message}`) });
      return;
    }

    const preview = buildMasterCalendarImportPreview(result.meta, result.exceptions, data.schedules, data.schoolCalendar);
    setState({
      step: "preview",
      meta: result.meta,
      exceptions: result.exceptions,
      preview,
      conflictResolution: "skip",
    });
  }

  function handleConfirm() {
    if (state.step !== "preview") return;
    const result = commitMasterCalendarImport({
      meta: state.meta,
      exceptions: state.exceptions,
      existingCalendar: data.schoolCalendar,
      bellSchedules: data.schedules,
      conflictResolution: state.conflictResolution,
      generateExceptionId: () => generateId("calendar-exception"),
      generateCalendarId: () => generateId("calendar"),
    });
    actions.importMasterCalendar(result);
    setState({ step: "closed" });
  }

  return (
    <div className="rounded-xl border border-falcon-brown-700/20 bg-white/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
          Import Master Calendar
        </h3>
        <button
          type="button"
          onClick={() => setState({ step: "closed" })}
          className="text-xs font-semibold text-falcon-brown-700/60 hover:underline"
        >
          Cancel
        </button>
      </div>

      {state.step === "input" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-falcon-brown-700/60">
            Falcon Deck JSON (<code>falcon-deck.master-calendar.v1</code>) or CSV. Choosing a file does not
            change anything until you confirm the import at the end.
          </p>
          <input type="file" accept=".json,.csv,application/json,text/csv" onChange={handleFile} className="text-sm" />
          <textarea
            value={state.text}
            onChange={(e) => setState({ step: "input", text: e.target.value, issues: [] })}
            rows={6}
            placeholder="Paste JSON or CSV content here"
            className="rounded-md border border-falcon-brown-700/30 bg-white p-2 font-mono text-xs text-falcon-brown-900"
          />
          {state.issues.length > 0 && (
            <div className="rounded-md border border-red-700/40 bg-red-50 p-2 text-xs text-red-800">
              <ul className="list-disc pl-4">
                {state.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            onClick={handleParse}
            disabled={state.text.trim().length === 0}
            className="self-start rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Parse &amp; Preview
          </button>
        </div>
      )}

      {state.step === "preview" && (
        <div className="flex flex-col gap-3">
          {state.meta && (
            <div className="grid grid-cols-2 gap-2 rounded-md border border-falcon-brown-700/15 bg-falcon-cream-100/40 p-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-falcon-brown-700/60">School Year</p>
                <p className="font-semibold text-falcon-brown-900">{state.meta.schoolYear || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-falcon-brown-700/60">Student Date Range</p>
                <p className="font-semibold text-falcon-brown-900">
                  {state.meta.firstStudentDay || "—"} – {state.meta.lastStudentDay || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-falcon-brown-700/60">Default Schedule Profile</p>
                <p className="font-semibold text-falcon-brown-900">{state.meta.defaultScheduleProfileKey || "—"}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="Exceptions" value={state.preview.totalExceptions} />
            <Stat label="No School" value={state.preview.noSchoolCount} />
            <Stat label="No Students" value={state.preview.noStudentsCount} />
            <Stat label="Special Bell" value={state.preview.specialBellCount} />
          </div>

          {state.preview.unresolvedProfileKeys.length > 0 && (
            <div className="rounded-md border border-amber-600/40 bg-amber-50 p-2 text-xs text-amber-900">
              {state.preview.unresolvedProfileKeys.length} schedule profile(s) need configuration:{" "}
              {state.preview.unresolvedProfileKeys.join(", ")} - placeholder &ldquo;Needs Configuration&rdquo;
              schedules will be created for these.
            </div>
          )}

          {state.preview.conflicts.length > 0 && (
            <div className="rounded-md border border-red-700/40 bg-red-50 p-3 text-xs text-red-900">
              <p className="mb-2 font-semibold">
                Conflicts found: {state.preview.conflicts.length} imported date(s) overlap existing exceptions.
              </p>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={state.conflictResolution === "skip"}
                    onChange={() => setState({ ...state, conflictResolution: "skip" })}
                  />
                  Skip conflicting rows (keep existing)
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={state.conflictResolution === "replace"}
                    onChange={() => setState({ ...state, conflictResolution: "replace" })}
                  />
                  Replace existing with imported
                </label>
              </div>
            </div>
          )}

          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {state.exceptions.map((exception, i) => (
              <li
                key={i}
                className="flex justify-between rounded-md border border-falcon-brown-700/15 bg-white/60 px-3 py-1.5"
              >
                <span className="font-medium text-falcon-brown-900">{exception.title || "(untitled)"}</span>
                <span className="text-falcon-brown-700/70">
                  {exception.startDate}
                  {exception.endDate !== exception.startDate ? ` – ${exception.endDate}` : ""} · {exception.type}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={handleConfirm}
            className="self-start rounded-md bg-falcon-gold-500 px-3 py-1.5 text-sm font-semibold text-falcon-brown-950"
          >
            Confirm Import
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-falcon-brown-700/15 bg-white/60 p-2">
      <p className="text-xs text-falcon-brown-700/60">{label}</p>
      <p className="text-lg font-bold text-falcon-brown-900">{value}</p>
    </div>
  );
}
