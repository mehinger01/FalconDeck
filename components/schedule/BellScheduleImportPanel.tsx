"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import {
  buildBellScheduleImportPayload,
  findScheduleNameConflict,
  parseBellScheduleCsv,
  type ParsedBellScheduleBlock,
} from "@/lib/schedule/bellScheduleImport";
import { importBellSchedule } from "@/lib/data/bellScheduleImportRpc";
import { generateId } from "@/lib/store/id";
import { DEFAULT_TIME_ZONE, formatTimeString } from "@/lib/schedule/time";

const IMPORT_FLASH_SESSION_KEY = "falcon-deck:bell-schedule-import-flash";
const IMPORT_FLASH_SUCCESS_MESSAGE =
  "Bell schedule imported successfully. Select it below when you're ready to use it.";

type ImportView = "closed" | "select" | "preview" | "pending";

interface ParsedImport {
  scheduleName: string;
  blocks: ParsedBellScheduleBlock[];
}

export function BellScheduleImportPanel({ organizationId }: { organizationId: string }) {
  const { data } = useAppData();
  const [view, setView] = useState<ImportView>("closed");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [parseIssues, setParseIssues] = useState<string[]>([]);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  useEffect(() => {
    const flash = sessionStorage.getItem(IMPORT_FLASH_SESSION_KEY);
    if (flash) {
      setFlashMessage(IMPORT_FLASH_SUCCESS_MESSAGE);
      sessionStorage.removeItem(IMPORT_FLASH_SESSION_KEY);
    }
  }, []);

  const effectiveName = (renameValue ?? parsed?.scheduleName ?? "").trim();
  const conflict = parsed ? findScheduleNameConflict(effectiveName, data.schedules) : null;
  const canImport = parsed !== null && effectiveName.length > 0 && conflict === null && view !== "pending";

  function resetImport() {
    setParsed(null);
    setParseIssues([]);
    setRenameValue(null);
    setRpcError(null);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const text = await file.text();
    const result = parseBellScheduleCsv(text);
    if (!result.ok) {
      resetImport();
      setParseIssues(
        result.issues.map((issue) => (issue.row != null ? `Row ${issue.row}: ${issue.message}` : issue.message)),
      );
      return;
    }

    setParseIssues([]);
    setRenameValue(null);
    setRpcError(null);
    setParsed({ scheduleName: result.scheduleName, blocks: result.blocks });
    setView("preview");
  }

  async function handleImport() {
    if (!parsed || view === "pending" || !canImport) return;

    setView("pending");
    setRpcError(null);

    const scheduleId = generateId("schedule");
    const blockIds = parsed.blocks.map(() => generateId("block"));
    const payload = buildBellScheduleImportPayload(scheduleId, blockIds, effectiveName, parsed.blocks);

    const result = await importBellSchedule({
      organizationId,
      scheduleId: payload.id,
      name: payload.name,
      timeZone: DEFAULT_TIME_ZONE,
      blocks: payload.blocks,
    });

    if (result.ok) {
      sessionStorage.setItem(IMPORT_FLASH_SESSION_KEY, result.scheduleName);
      window.location.reload();
      return;
    }

    setRpcError(result.message);
    setView("preview");
  }

  const flashBanner = flashMessage && (
    <div className="mb-3 rounded-md border border-green-700/40 bg-green-50 px-3 py-2 text-sm text-green-900">
      {flashMessage}
    </div>
  );

  if (view === "closed") {
    return (
      <div>
        {flashBanner}
        <button
          type="button"
          onClick={() => setView("select")}
          className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-700 hover:bg-falcon-cream-100"
        >
          Import Bell Schedule
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-falcon-brown-700/20 bg-white/70 p-4">
      {flashBanner}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Import Bell Schedule</h3>
        <button
          type="button"
          onClick={() => {
            resetImport();
            setView("closed");
          }}
          disabled={view === "pending"}
          className="text-xs font-semibold text-falcon-brown-700/60 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {view === "select" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-falcon-brown-700/60">
            Download the template, fill it out, then upload it here. Columns: schedule_name, block_name, block_type
            (class, passing, lunch, prep, or enrichment), start_time, end_time.
          </p>
          <a
            href="/falcon-deck-bell-schedule-template.csv"
            download
            className="self-start text-xs font-semibold text-falcon-brown-700 underline hover:text-falcon-brown-900"
          >
            Download CSV Template
          </a>
          <input type="file" accept=".csv,text/csv" onChange={handleFile} className="text-sm" />
          {parseIssues.length > 0 && (
            <div className="rounded-md border border-red-700/40 bg-red-50 p-2 text-xs text-red-800">
              <ul className="list-disc pl-4">
                {parseIssues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {view !== "select" && parsed && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Schedule name</span>
            <input
              value={renameValue ?? parsed.scheduleName}
              onChange={(e) => setRenameValue(e.target.value)}
              disabled={view === "pending"}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900 disabled:opacity-60"
            />
          </label>

          {conflict && (
            <div className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">
                A schedule named &ldquo;{conflict.name}&rdquo; already exists. Rename this import above, or cancel.
              </p>
              <p className="mt-1 text-amber-800/80">
                This never changes or replaces the existing &ldquo;{conflict.name}&rdquo; schedule.
              </p>
            </div>
          )}

          {rpcError && (
            <div className="rounded-md border border-red-700/40 bg-red-50 p-2 text-xs text-red-800">{rpcError}</div>
          )}

          <p className="text-xs text-falcon-brown-700/60">{parsed.blocks.length} block(s) validated:</p>
          <ul className="space-y-1 text-sm">
            {parsed.blocks.map((block, i) => (
              <li
                key={i}
                className="flex justify-between rounded-md border border-falcon-brown-700/15 bg-white/60 px-3 py-1.5"
              >
                <span className="font-medium text-falcon-brown-900">
                  {block.label} <span className="text-xs text-falcon-brown-700/50">({block.kind})</span>
                </span>
                <span className="text-falcon-brown-700/70">
                  {formatTimeString(block.startTime)} - {formatTimeString(block.endTime)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-falcon-brown-700/60">
            This creates a new private schedule just for you - it will not become your active schedule until you
            choose it below.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport}
              className="self-start rounded-md bg-falcon-gold-500 px-3 py-1.5 text-sm font-semibold text-falcon-brown-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {view === "pending" ? "Importing..." : "Import"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetImport();
                setView("select");
              }}
              disabled={view === "pending"}
              className="self-start rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Choose a Different File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
