import type { BellSchedule, BlockKind } from "@/types/schedule";
import { timeStringToSeconds } from "./time";

const REQUIRED_HEADERS = ["schedule_name", "block_name", "block_type", "start_time", "end_time"] as const;
type RequiredHeader = (typeof REQUIRED_HEADERS)[number];

const CSV_BLOCK_TYPE_TO_KIND: Record<string, BlockKind> = {
  class: "instructional",
  passing: "passing",
  lunch: "lunch",
  prep: "prep",
  enrichment: "enrichment",
};

const STUDENT_FACING_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>(["instructional", "enrichment"]);

export interface BellScheduleImportIssue {
  row?: number;
  message: string;
}

export interface ParsedBellScheduleBlock {
  label: string;
  kind: BlockKind;
  startTime: string;
  endTime: string;
}

export type BellScheduleCsvParseResult =
  | { ok: true; scheduleName: string; blocks: ParsedBellScheduleBlock[] }
  | { ok: false; issues: BellScheduleImportIssue[] };

export interface BellScheduleImportPayloadBlock {
  id: string;
  label: string;
  kind: BlockKind;
  startTime: string;
  endTime: string;
}

export interface BellScheduleImportPayload {
  id: string;
  name: string;
  blocks: BellScheduleImportPayloadBlock[];
}

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function parseFlexibleTime(raw: string): string | null {
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

function detectDelimiter(headerLine: string): string {
  return headerLine.includes("\t") ? "\t" : ",";
}

function parseCsvRow(line: string, delimiter: string): string[] | null {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let fieldHasClosedQuote = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
          fieldHasClosedQuote = true;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' && current === "" && !fieldHasClosedQuote) {
      inQuotes = true;
      continue;
    }

    if (char === '"') {
      return null;
    }

    if (char === delimiter) {
      cells.push(current.trim());
      current = "";
      fieldHasClosedQuote = false;
      continue;
    }

    current += char;
  }

  if (inQuotes) return null;
  cells.push(current.trim());
  return cells;
}

interface RawRow {
  rowNumber: number;
  scheduleName: string;
  blockName: string;
  blockType: string;
  startTime: string;
  endTime: string;
}

export function parseBellScheduleCsv(rawText: string): BellScheduleCsvParseResult {
  const text = stripBom(rawText);
  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { ok: false, issues: [{ message: "This file is empty." }] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headerCells = parseCsvRow(lines[0], delimiter);
  if (!headerCells) {
    return { ok: false, issues: [{ message: "The header row has malformed CSV quoting (check for an unclosed or misplaced quote)." }] };
  }

  const headerIndexByName = new Map<string, number[]>();
  headerCells.forEach((cell, index) => {
    const key = cell.toLowerCase();
    const existing = headerIndexByName.get(key) ?? [];
    existing.push(index);
    headerIndexByName.set(key, existing);
  });

  const missingHeaders = REQUIRED_HEADERS.filter((name) => !headerIndexByName.has(name));
  if (missingHeaders.length > 0) {
    return {
      ok: false,
      issues: [{ message: `Missing required column${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}.` }],
    };
  }

  const duplicatedHeaders = REQUIRED_HEADERS.filter((name) => (headerIndexByName.get(name)?.length ?? 0) > 1);
  if (duplicatedHeaders.length > 0) {
    return {
      ok: false,
      issues: [{ message: `Duplicate column${duplicatedHeaders.length === 1 ? "" : "s"}: ${duplicatedHeaders.join(", ")}.` }],
    };
  }

  // Stage E uses the exact 5-column schema, never a superset - reached only
  // once every required header is present with no duplicates (both checked
  // above), so the only way headerCells.length can still differ from
  // REQUIRED_HEADERS.length here is an extra/unexpected column (a named one
  // like owner_id/organization_id/id, or a blank one from a trailing
  // delimiter) - never a case this function would otherwise mistake for a
  // missing or duplicated required header.
  if (headerCells.length !== REQUIRED_HEADERS.length) {
    return {
      ok: false,
      issues: [{ message: `Expected exactly ${REQUIRED_HEADERS.length} columns (${REQUIRED_HEADERS.join(", ")}), found ${headerCells.length}.` }],
    };
  }

  const columnIndex: Record<RequiredHeader, number> = {
    schedule_name: headerIndexByName.get("schedule_name")![0],
    block_name: headerIndexByName.get("block_name")![0],
    block_type: headerIndexByName.get("block_type")![0],
    start_time: headerIndexByName.get("start_time")![0],
    end_time: headerIndexByName.get("end_time")![0],
  };

  const dataLines = lines.slice(1);
  if (dataLines.length === 0) {
    return { ok: false, issues: [{ message: "This file has no data rows." }] };
  }

  const issues: BellScheduleImportIssue[] = [];
  const rawRows: RawRow[] = [];

  dataLines.forEach((line, index) => {
    const rowNumber = index + 1;
    const cells = parseCsvRow(line, delimiter);
    if (!cells) {
      issues.push({ row: rowNumber, message: "This row has malformed CSV quoting (check for an unclosed or misplaced quote)." });
      return;
    }
    // Every data row must have exactly 5 parsed cells, same as the header -
    // without this, an extra/trailing cell (e.g. a stray delimiter, or an
    // unquoted comma inside what was meant to be one field) can silently
    // line up with the 5 expected column indexes and be accepted as valid,
    // or silently drop a trailing cell's content. A too-few-cells row is
    // usually still caught downstream (a missing field reads as blank/
    // invalid), but that's incidental, not a guaranteed rejection - this
    // check makes "wrong cell count" its own explicit, reliable failure.
    if (cells.length !== REQUIRED_HEADERS.length) {
      issues.push({
        row: rowNumber,
        message: `Expected exactly ${REQUIRED_HEADERS.length} columns, found ${cells.length}.`,
      });
      return;
    }
    rawRows.push({
      rowNumber,
      scheduleName: cells[columnIndex.schedule_name] ?? "",
      blockName: cells[columnIndex.block_name] ?? "",
      blockType: cells[columnIndex.block_type] ?? "",
      startTime: cells[columnIndex.start_time] ?? "",
      endTime: cells[columnIndex.end_time] ?? "",
    });
  });

  let canonicalScheduleName: string | null = null;
  for (const row of rawRows) {
    if (!row.scheduleName) {
      issues.push({ row: row.rowNumber, message: "schedule_name is blank." });
    } else if (canonicalScheduleName === null) {
      canonicalScheduleName = row.scheduleName;
    } else if (row.scheduleName !== canonicalScheduleName) {
      issues.push({
        row: row.rowNumber,
        message: `schedule_name "${row.scheduleName}" does not match "${canonicalScheduleName}" - a CSV file describes exactly one schedule.`,
      });
    }
  }

  const parsedBlocks: ParsedBellScheduleBlock[] = [];
  for (const row of rawRows) {
    if (!row.blockName) {
      issues.push({ row: row.rowNumber, message: "block_name is blank." });
      continue;
    }

    const kind = CSV_BLOCK_TYPE_TO_KIND[row.blockType.toLowerCase()];
    if (!kind) {
      issues.push({
        row: row.rowNumber,
        message: `"${row.blockType}" is not a recognized block_type (expected class, passing, lunch, prep, or enrichment).`,
      });
      continue;
    }

    const startTime = parseFlexibleTime(row.startTime);
    if (!startTime) {
      issues.push({ row: row.rowNumber, message: `"${row.startTime}" is not a valid start_time (expected HH:MM).` });
      continue;
    }
    const endTime = parseFlexibleTime(row.endTime);
    if (!endTime) {
      issues.push({ row: row.rowNumber, message: `"${row.endTime}" is not a valid end_time (expected HH:MM).` });
      continue;
    }
    if (timeStringToSeconds(endTime) <= timeStringToSeconds(startTime)) {
      issues.push({ row: row.rowNumber, message: `"${row.blockName}" ends at or before it starts.` });
      continue;
    }

    parsedBlocks.push({ label: row.blockName, kind, startTime, endTime });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const sorted = [...parsedBlocks].sort((a, b) => timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime));
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (timeStringToSeconds(current.endTime) > timeStringToSeconds(next.startTime)) {
      return { ok: false, issues: [{ message: `"${current.label}" overlaps with "${next.label}".` }] };
    }
  }

  if (!sorted.some((block) => STUDENT_FACING_KINDS.has(block.kind))) {
    return { ok: false, issues: [{ message: "At least one class (instructional) or enrichment block is required." }] };
  }

  return { ok: true, scheduleName: canonicalScheduleName ?? "", blocks: sorted };
}

export function findScheduleNameConflict(name: string, existingSchedules: BellSchedule[]): BellSchedule | null {
  const needle = name.trim().toLowerCase();
  return existingSchedules.find((schedule) => schedule.name.trim().toLowerCase() === needle) ?? null;
}

export function buildBellScheduleImportPayload(
  scheduleId: string,
  blockIds: string[],
  name: string,
  blocks: ParsedBellScheduleBlock[],
): BellScheduleImportPayload {
  if (blockIds.length !== blocks.length) {
    throw new Error("Block id count must match imported block count.");
  }
  return {
    id: scheduleId,
    name,
    blocks: blocks.map((block, index) => ({
      id: blockIds[index],
      label: block.label,
      kind: block.kind,
      startTime: block.startTime,
      endTime: block.endTime,
    })),
  };
}
