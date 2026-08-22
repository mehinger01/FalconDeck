"use client";

import { useState, type ChangeEvent } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import {
  buildScheduleBlocksFromRows,
  parseBellScheduleTable,
  type ParsedScheduleRow,
} from "@/lib/schedule/bellScheduleImport";
import { formatTimeString } from "@/lib/schedule/time";
import { generateId } from "@/lib/store/id";
import type { BellSchedule } from "@/types/schedule";

type ImportStep =
  | { step: "closed" }
  | { step: "input"; text: string; issues: string[] }
  | { step: "preview"; rows: ParsedScheduleRow[]; name: string };

/**
 * CSV file or pasted table -> parse -> preview -> name -> confirm. The
 * parsed schedule is never activated automatically - it's only added to
 * the schedule list (see actions.addBuiltInSchedule) once the teacher
 * confirms, and only becomes selectable afterward; nothing here ever
 * touches the current default schedule.
 */
export function BellScheduleImportPanel() {
  const { actions } = useAppData();
  const [state, setState] = useState<ImportStep>({ step: "closed" });

  if (state.step === "closed") {
    return (
      <button
        type="button"
        onClick={() => setState({ step: "input", text: "", issues: [] })}
        className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-700 hover:bg-falcon-cream-100"
      >
        Import Bell Schedule
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
    const result = parseBellScheduleTable(state.text);
    if (!result.ok) {
      setState({ step: "input", text: state.text, issues: result.issues.map((i) => `Row ${i.rowIndex}: ${i.message}`) });
      return;
    }
    setState({ step: "preview", rows: result.rows, name: "Imported Schedule" });
  }

  function handleConfirm() {
    if (state.step !== "preview") return;
    const scheduleId = generateId("schedule-imported");
    const schedule: BellSchedule = {
      id: scheduleId,
      name: state.name.trim() || "Imported Schedule",
      isDefault: false,
      timeZone: "America/Detroit",
      source: "imported",
      blocks: buildScheduleBlocksFromRows(state.rows, scheduleId),
    };
    actions.addBuiltInSchedule(schedule);
    setState({ step: "closed" });
  }

  return (
    <div className="rounded-xl border border-falcon-brown-700/20 bg-white/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
          Import Bell Schedule
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
            Upload a CSV file, or paste a table with columns: label, start_time, end_time, kind,
            class_section. Example: <code>Period 1,7:25 AM,8:23 AM,instructional,</code>
          </p>
          <input type="file" accept=".csv,text/csv" onChange={handleFile} className="text-sm" />
          <textarea
            value={state.text}
            onChange={(e) => setState({ step: "input", text: e.target.value, issues: [] })}
            rows={6}
            placeholder="label,start_time,end_time,kind,class_section"
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
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Schedule name</span>
            <input
              value={state.name}
              onChange={(e) => setState({ step: "preview", rows: state.rows, name: e.target.value })}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>
          <ul className="space-y-1 text-sm">
            {state.rows.map((row, i) => (
              <li key={i} className="flex justify-between rounded-md border border-falcon-brown-700/15 bg-white/60 px-3 py-1.5">
                <span className="font-medium text-falcon-brown-900">
                  {row.label} <span className="text-xs text-falcon-brown-700/50">({row.kind})</span>
                </span>
                <span className="text-falcon-brown-700/70">
                  {formatTimeString(row.startTime)} – {formatTimeString(row.endTime)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-falcon-brown-700/60">
            {state.rows.length} block(s) validated. This will be added to your Bell Schedules - it won&rsquo;t
            become your default until you choose &ldquo;Use as Default.&rdquo;
          </p>
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
