import type { BlockKind, ScheduleBlock } from "@/types/schedule";
import { BLOCK_KINDS } from "@/types/schedule";
import { timeStringToSeconds } from "./time";

/**
 * CSV/paste-table import for a single Bell Schedule (Part 4) - deliberately
 * separate from the Master Calendar importer (lib/calendar/masterCalendarImport.ts),
 * which imports exceptions, not bell times. Pure parsing/validation only;
 * the caller decides what to do with a successful result (preview it, let
 * the teacher name it, then dispatch it - never auto-activated).
 */

export interface ParsedScheduleRow {
  label: string;
  /** 24h "HH:mm" */
  startTime: string;
  /** 24h "HH:mm" */
  endTime: string;
  kind: BlockKind;
  customKindLabel?: string;
}

export interface ScheduleImportRowIssue {
  rowIndex: number;
  message: string;
}

export type ScheduleImportParseResult =
  | { ok: true; rows: ParsedScheduleRow[] }
  | { ok: false; issues: ScheduleImportRowIssue[] };

/** Accepts "7:25 AM" / "7:25AM" (12h) or "07:25" / "7:25" (24h, no AM/PM). */
function parseDisplayTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hours, minutes] = trimmed.split(":").map(Number);
    if (hours > 23 || minutes > 59) return null;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  const period = match[3].toUpperCase();
  hours = period === "AM" ? (hours === 12 ? 0 : hours) : hours === 12 ? 12 : hours + 12;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function normalizeKind(raw: string): { kind: BlockKind; customKindLabel?: string } {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if ((BLOCK_KINDS as readonly string[]).includes(lower)) return { kind: lower as BlockKind };
  if (trimmed.length === 0) return { kind: "custom" };
  return { kind: "custom", customKindLabel: trimmed };
}

function splitRow(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
}

function detectDelimiter(headerLine: string): string {
  return headerLine.includes("\t") ? "\t" : ",";
}

/**
 * Parses either a CSV file's contents or a pasted spreadsheet table (tab-
 * delimited, as browsers paste from Excel/Sheets) - both use the same
 * label/start_time/end_time/kind/class_section shape. A header row is
 * optional; if the first row doesn't look like a header, every row is
 * treated as data in column order (label, start_time, end_time, kind,
 * class_section).
 */
export function parseBellScheduleTable(raw: string): ScheduleImportParseResult {
  const lines = raw.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { ok: false, issues: [{ rowIndex: 0, message: "No rows found." }] };

  const delimiter = detectDelimiter(lines[0]);
  const firstRowCells = splitRow(lines[0], delimiter).map((cell) => cell.toLowerCase());
  const hasHeader = firstRowCells.includes("label") || firstRowCells.includes("start_time");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const labelCol = hasHeader ? firstRowCells.indexOf("label") : 0;
  const startCol = hasHeader ? firstRowCells.indexOf("start_time") : 1;
  const endCol = hasHeader ? firstRowCells.indexOf("end_time") : 2;
  const kindCol = hasHeader ? firstRowCells.indexOf("kind") : 3;

  if (dataLines.length === 0) {
    return { ok: false, issues: [{ rowIndex: 0, message: "No data rows found." }] };
  }

  const issues: ScheduleImportRowIssue[] = [];
  const rows: ParsedScheduleRow[] = [];

  dataLines.forEach((line, index) => {
    const rowIndex = index + 1;
    const cells = splitRow(line, delimiter);
    const label = (labelCol >= 0 ? (cells[labelCol] ?? "") : "").trim();
    const rawStart = (startCol >= 0 ? (cells[startCol] ?? "") : "").trim();
    const rawEnd = (endCol >= 0 ? (cells[endCol] ?? "") : "").trim();
    const rawKind = kindCol >= 0 ? (cells[kindCol] ?? "") : "";

    if (!label) {
      issues.push({ rowIndex, message: "Missing a label." });
      return;
    }
    const startTime = parseDisplayTime(rawStart);
    if (!startTime) {
      issues.push({ rowIndex, message: `Invalid start time "${rawStart}".` });
      return;
    }
    const endTime = parseDisplayTime(rawEnd);
    if (!endTime) {
      issues.push({ rowIndex, message: `Invalid end time "${rawEnd}".` });
      return;
    }
    if (timeStringToSeconds(endTime) <= timeStringToSeconds(startTime)) {
      issues.push({ rowIndex, message: `"${label}" ends at or before it starts.` });
      return;
    }

    const { kind, customKindLabel } = normalizeKind(rawKind);
    rows.push({ label, startTime, endTime, kind, customKindLabel });
  });

  if (issues.length > 0) return { ok: false, issues };

  const sorted = [...rows].sort((a, b) => timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime));
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (timeStringToSeconds(current.endTime) > timeStringToSeconds(next.startTime)) {
      return {
        ok: false,
        issues: [{ rowIndex: 0, message: `"${current.label}" overlaps with "${next.label}".` }],
      };
    }
  }

  return { ok: true, rows };
}

/**
 * Turns a successfully-parsed import into real ScheduleBlocks. `class_section`
 * is deliberately never auto-assigned here, even if a column was present -
 * an imported schedule starts with every block unassigned rather than
 * guessing a class section, and the teacher assigns them afterward.
 */
export function buildScheduleBlocksFromRows(rows: ParsedScheduleRow[], scheduleId: string): ScheduleBlock[] {
  return rows.map((row, index) => ({
    id: `${scheduleId}-block-${index}`,
    label: row.label,
    kind: row.kind,
    customKindLabel: row.customKindLabel,
    startTime: row.startTime,
    endTime: row.endTime,
    classSectionId: null,
    overrides: [],
  }));
}
