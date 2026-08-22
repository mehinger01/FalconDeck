"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import {
  buildMasterCalendarImportPreview,
  commitMasterCalendarImport,
  parseMasterCalendarCsv,
  validateParsedExceptions,
  type CalendarConflictResolution,
  type CalendarImportMeta,
  type CalendarImportRowIssue,
  type MasterCalendarImportPreview,
  type ParsedCalendarException,
} from "@/lib/calendar/masterCalendarImport";
import { formatCalendarExceptionDateRange } from "@/lib/calendar/formatCalendarDate";
import { generateId } from "@/lib/store/id";
import type { SchoolDayExceptionType } from "@/types/calendar";

type ImportPanelState =
  | { step: "idle" }
  | { step: "parse-error"; issues: string[] }
  | {
      step: "review";
      meta: CalendarImportMeta | null;
      exceptions: ParsedCalendarException[];
      validationIssues: string[];
      preview: MasterCalendarImportPreview;
      conflictResolution: CalendarConflictResolution;
    }
  | { step: "success"; count: number };

const TYPE_LABELS: Record<SchoolDayExceptionType, string> = {
  "no-school": "No School",
  "no-students": "No Students",
  "special-bell": "Special Schedule",
};

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatIssue(issue: CalendarImportRowIssue): string {
  return issue.rowIndex > 0 ? `Row ${issue.rowIndex}: ${issue.message}` : issue.message;
}

/**
 * Upload Completed Template -> parse -> validate -> Review Calendar ->
 * Apply Calendar. Nothing here mutates AppData until "Apply Calendar" is
 * clicked - see lib/calendar/masterCalendarImport.ts for the pure
 * parse/validate/preview/commit pipeline this drives.
 *
 * File-upload only, matching the printed CSV template contract exactly -
 * no manual paste, no separate JSON path in this teacher-facing workflow
 * (the falcon-deck.master-calendar.v1 JSON schema still exists and is
 * still exercised by parseMasterCalendarJson elsewhere, e.g. Demo Mode's
 * seed data, but isn't part of this UI).
 *
 * Renders as a fragment so the trigger button sits inline in
 * MasterCalendarScreen's existing button row, while the review/error
 * card (given `w-full`) naturally wraps onto its own line beneath it in
 * that same flex-wrap row - no parent restructuring needed.
 */
export function MasterCalendarImportPanel() {
  const { data, actions } = useAppData();
  const [state, setState] = useState<ImportPanelState>({ step: "idle" });

  useEffect(() => {
    if (state.step !== "success") return;
    const timer = setTimeout(() => setState({ step: "idle" }), 6000);
    return () => clearTimeout(timer);
  }, [state]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same filename be re-selected later (e.g. after fixing it externally)
    if (!file) return;

    if (file.size === 0) {
      setState({ step: "parse-error", issues: ["That file is empty. Choose your completed Master Calendar template."] });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setState({ step: "parse-error", issues: ["Please upload a .csv file - the completed Master Calendar template."] });
      return;
    }

    const text = await file.text();
    const result = parseMasterCalendarCsv(text);
    if (!result.ok) {
      setState({ step: "parse-error", issues: result.issues.map(formatIssue) });
      return;
    }

    const validationIssues = validateParsedExceptions(result.exceptions);
    const preview = buildMasterCalendarImportPreview(result.meta, result.exceptions, data.schedules, data.schoolCalendar);
    setState({
      step: "review",
      meta: result.meta,
      exceptions: result.exceptions,
      validationIssues: validationIssues.map(formatIssue),
      preview,
      conflictResolution: "skip",
    });
  }

  function handleApply() {
    if (state.step !== "review" || state.validationIssues.length > 0) return;

    const conflictingIndices = new Set(state.preview.conflicts.map((c) => c.newExceptionIndex));
    const addedCount =
      state.conflictResolution === "replace"
        ? state.exceptions.length
        : state.exceptions.length - conflictingIndices.size;

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
    setState({ step: "success", count: addedCount });
  }

  const existingExceptionCount = data.schoolCalendar?.exceptions.length ?? 0;

  return (
    <>
      <label className="cursor-pointer rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-falcon-brown-800">
        Upload Completed Template
        <input type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
      </label>

      {state.step === "success" && (
        <p className="text-sm font-semibold text-green-800">
          ✓ Master calendar updated — {state.count} exception{state.count === 1 ? "" : "s"} added.
        </p>
      )}

      {state.step === "parse-error" && (
        <div className="mt-3 w-full rounded-lg border border-red-700/40 bg-red-50 p-3 text-sm text-red-900">
          <p className="mb-2 font-semibold">Falcon Deck couldn&rsquo;t read that file:</p>
          <ul className="list-disc space-y-1 pl-5">
            {state.issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setState({ step: "idle" })}
            className="mt-3 rounded-md border border-red-700/40 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
          >
            Try a different file
          </button>
        </div>
      )}

      {state.step === "review" && (
        <div className="mt-3 w-full rounded-xl border border-falcon-brown-700/20 bg-white/70 p-4">
          <h3 className="text-lg font-bold text-falcon-brown-900">
            {state.preview.meta?.schoolYear ? `${state.preview.meta.schoolYear} Master Calendar` : "Review Calendar"}
          </h3>

          <ul className="mt-2 space-y-0.5 text-sm text-falcon-brown-800">
            <li>
              {state.preview.totalExceptions} exception{state.preview.totalExceptions === 1 ? "" : "s"} found
            </li>
            <li>
              {state.preview.noSchoolCount} no-school date{state.preview.noSchoolCount === 1 ? "" : "s"}
            </li>
            <li>
              {state.preview.noStudentsCount} no-student date{state.preview.noStudentsCount === 1 ? "" : "s"}
            </li>
            <li>
              {state.preview.specialBellCount} early-release / special schedule
              {state.preview.specialBellCount === 1 ? "" : "s"}
            </li>
            {state.preview.affectedDateCount > 0 && (
              <li>
                {state.preview.affectedDateCount} school date{state.preview.affectedDateCount === 1 ? "" : "s"} affected
              </li>
            )}
            <li
              className={
                state.validationIssues.length > 0 ? "font-semibold text-red-800" : "font-semibold text-green-800"
              }
            >
              {state.validationIssues.length > 0
                ? `${state.validationIssues.length} error${state.validationIssues.length === 1 ? "" : "s"} found`
                : "No errors found"}
            </li>
          </ul>

          {state.validationIssues.length > 0 && (
            <div className="mt-3 rounded-md border border-red-700/40 bg-red-50 p-3 text-sm text-red-900">
              <p className="mb-1 font-semibold">Fix these before applying the calendar:</p>
              <ul className="list-disc space-y-1 pl-5">
                {state.validationIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          {state.preview.unresolvedProfileKeys.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-600/40 bg-amber-50 p-2 text-xs text-amber-900">
              {state.preview.unresolvedProfileKeys.length} schedule profile
              {state.preview.unresolvedProfileKeys.length === 1 ? "" : "s"} need configuration:{" "}
              {state.preview.unresolvedProfileKeys.join(", ")} - a placeholder will be created so you can add
              their bell times later in Bell Schedules.
            </div>
          )}

          <p className="mt-3 text-xs text-falcon-brown-700/60">
            {existingExceptionCount > 0
              ? `Adding to your existing calendar - your ${existingExceptionCount} current exception${existingExceptionCount === 1 ? "" : "s"} will be kept.`
              : "This will become your Master Calendar."}
          </p>

          {state.preview.conflicts.length > 0 && (
            <div className="mt-3 rounded-md border border-red-700/40 bg-red-50 p-3 text-xs text-red-900">
              <p className="mb-2 font-semibold">
                {state.preview.conflicts.length} date{state.preview.conflicts.length === 1 ? "" : "s"} in this file
                overlap{state.preview.conflicts.length === 1 ? "s" : ""} an exception you already have.
              </p>
              <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={state.conflictResolution === "skip"}
                    onChange={() => setState({ ...state, conflictResolution: "skip" })}
                  />
                  Keep my existing entries for those dates
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={state.conflictResolution === "replace"}
                    onChange={() => setState({ ...state, conflictResolution: "replace" })}
                  />
                  Replace them with the uploaded entries
                </label>
              </div>
            </div>
          )}

          <div className="mt-3 overflow-x-auto rounded-lg border border-falcon-brown-700/15">
            <table className="w-full text-left text-sm">
              <thead className="bg-falcon-cream-100/60 text-xs uppercase tracking-wide text-falcon-brown-700/70">
                <tr>
                  <th className="px-3 py-2">Date / Range</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Schedule</th>
                  <th className="px-3 py-2">Dismissal</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {state.exceptions.map((exception, i) => (
                  <tr key={i} className="border-t border-falcon-brown-700/10">
                    <td className="px-3 py-2 font-medium text-falcon-brown-900">
                      {DATE_KEY_PATTERN.test(exception.startDate) && DATE_KEY_PATTERN.test(exception.endDate)
                        ? formatCalendarExceptionDateRange(exception.startDate, exception.endDate)
                        : `${exception.startDate || "?"} – ${exception.endDate || "?"}`}
                    </td>
                    <td className="px-3 py-2 text-falcon-brown-700">{TYPE_LABELS[exception.type] ?? exception.type}</td>
                    <td className="px-3 py-2 text-falcon-brown-700">{exception.scheduleProfileKey ?? "—"}</td>
                    <td className="px-3 py-2 text-falcon-brown-700">{exception.dismissalTime ?? "—"}</td>
                    <td className="px-3 py-2 text-falcon-brown-700/70">{exception.notes || exception.title || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={state.validationIssues.length > 0}
              className="rounded-md bg-falcon-gold-500 px-4 py-2 text-sm font-bold text-falcon-brown-950 hover:bg-falcon-gold-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-falcon-gold-500"
            >
              Apply Calendar
            </button>
            <button
              type="button"
              onClick={() => setState({ step: "idle" })}
              className="rounded-md border border-falcon-brown-700/30 px-4 py-2 text-sm font-semibold text-falcon-brown-700 hover:bg-falcon-cream-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
