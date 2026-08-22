import type { BellSchedule } from "@/types/schedule";
import type { SchoolCalendarException, SchoolDayExceptionType, SchoolYearCalendar } from "@/types/calendar";
import { OHHS_REGULAR_ID } from "@/lib/schedule/presets/ohhsRegular";
import {
  OHHS_EARLY_RELEASE_1124_ID,
  OHHS_LAST_DAY_HALF_DAY_ID,
  createOhhsEarlyRelease1124Schedule,
  createOhhsLastDayHalfDaySchedule,
} from "@/lib/schedule/presets/needsConfigurationSchedules";

/**
 * Master Calendar import: JSON (falcon-deck.master-calendar.v1) and CSV,
 * parsed and validated into plain data with zero side effects. Every
 * function here is pure - nothing touches AppData. The UI drives:
 *
 *   parse -> validate -> preview (buildImportPreview) -> resolve profiles
 *   -> detect conflicts -> commitMasterCalendarImport -> dispatch
 *
 * and only the final dispatch (outside this module) ever mutates state.
 */

export const CALENDAR_EXCEPTION_TYPES: readonly SchoolDayExceptionType[] = [
  "no-school",
  "no-students",
  "special-bell",
];

export const MASTER_CALENDAR_SCHEMA_V1 = "falcon-deck.master-calendar.v1";

export interface ParsedCalendarException {
  startDate: string;
  endDate: string;
  type: SchoolDayExceptionType;
  title: string;
  scheduleProfileKey?: string;
  dismissalTime?: string;
  notes?: string;
}

export interface CalendarImportMeta {
  name?: string;
  school?: string;
  district?: string;
  schoolYear: string;
  timeZone: string;
  firstStudentDay: string;
  lastStudentDay: string;
  defaultScheduleProfileKey: string;
}

export interface CalendarImportRowIssue {
  rowIndex: number;
  message: string;
}

export type CalendarImportParseResult =
  | { ok: true; meta: CalendarImportMeta | null; exceptions: ParsedCalendarException[] }
  | { ok: false; issues: CalendarImportRowIssue[] };

function isValidDateKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Shared row-level validation for both JSON- and CSV-sourced exceptions. */
export function validateParsedExceptions(exceptions: ParsedCalendarException[]): CalendarImportRowIssue[] {
  const issues: CalendarImportRowIssue[] = [];
  exceptions.forEach((exception, i) => {
    const rowIndex = i + 1;
    if (!isValidDateKey(exception.startDate)) {
      issues.push({ rowIndex, message: `Invalid start date "${exception.startDate ?? ""}".` });
    }
    if (!isValidDateKey(exception.endDate)) {
      issues.push({ rowIndex, message: `Invalid end date "${exception.endDate ?? ""}".` });
    }
    if (isValidDateKey(exception.startDate) && isValidDateKey(exception.endDate) && exception.endDate < exception.startDate) {
      issues.push({ rowIndex, message: `End date (${exception.endDate}) is before start date (${exception.startDate}).` });
    }
    if (!CALENDAR_EXCEPTION_TYPES.includes(exception.type)) {
      issues.push({
        rowIndex,
        message: `Unknown type "${exception.type}" - expected one of: ${CALENDAR_EXCEPTION_TYPES.join(", ")}.`,
      });
    }
    if (!exception.title || exception.title.trim().length === 0) {
      issues.push({ rowIndex, message: "Missing a title." });
    }
  });
  return issues;
}

/** Parses `falcon-deck.master-calendar.v1` JSON. Never throws - malformed JSON becomes a row-0 issue. */
export function parseMasterCalendarJson(raw: string): CalendarImportParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, issues: [{ rowIndex: 0, message: "That file isn't valid JSON." }] };
  }

  if (typeof data !== "object" || data === null) {
    return { ok: false, issues: [{ rowIndex: 0, message: "Expected a JSON object at the top level." }] };
  }
  const root = data as Record<string, unknown>;

  if (root.schema !== MASTER_CALENDAR_SCHEMA_V1) {
    return {
      ok: false,
      issues: [{ rowIndex: 0, message: `Unrecognized schema - expected "${MASTER_CALENDAR_SCHEMA_V1}".` }],
    };
  }

  const meta: CalendarImportMeta = {
    name: typeof root.name === "string" ? root.name : undefined,
    school: typeof root.school === "string" ? root.school : undefined,
    district: typeof root.district === "string" ? root.district : undefined,
    schoolYear: typeof root.schoolYear === "string" ? root.schoolYear : "",
    timeZone: typeof root.timeZone === "string" ? root.timeZone : "America/Detroit",
    firstStudentDay: typeof root.firstStudentDay === "string" ? root.firstStudentDay : "",
    lastStudentDay: typeof root.lastStudentDay === "string" ? root.lastStudentDay : "",
    defaultScheduleProfileKey: typeof root.defaultScheduleProfile === "string" ? root.defaultScheduleProfile : "",
  };

  const rawExceptions = Array.isArray(root.exceptions) ? root.exceptions : [];
  const exceptions: ParsedCalendarException[] = rawExceptions.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      startDate: typeof row.startDate === "string" ? row.startDate : "",
      endDate: typeof row.endDate === "string" ? row.endDate : typeof row.startDate === "string" ? row.startDate : "",
      type: (typeof row.type === "string" ? row.type : "") as SchoolDayExceptionType,
      title: typeof row.title === "string" ? row.title : "",
      scheduleProfileKey: typeof row.scheduleProfile === "string" ? row.scheduleProfile : undefined,
      dismissalTime: typeof row.dismissalTime === "string" ? row.dismissalTime : undefined,
      notes: typeof row.notes === "string" ? row.notes : undefined,
    };
  });

  return { ok: true, meta, exceptions };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Parses a CSV whose header row can include any of: date, start_date,
 * end_date, type, title, schedule_profile, dismissal_time, notes,
 * student_status, affects_bell_schedule (the last two are accepted but not
 * currently used - `type` is authoritative). A single `date` column stands
 * in for both start_date and end_date on a one-day row.
 */
export function parseMasterCalendarCsv(raw: string): CalendarImportParseResult {
  const lines = raw.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { ok: false, issues: [{ rowIndex: 0, message: "That file is empty." }] };

  const header = parseCsvLine(lines[0]).map((cell) => cell.toLowerCase());
  const columnIndex = (name: string) => header.indexOf(name);
  const dateCol = columnIndex("date");
  const startCol = columnIndex("start_date");
  const endCol = columnIndex("end_date");
  const typeCol = columnIndex("type");
  const titleCol = columnIndex("title");
  const profileCol = columnIndex("schedule_profile");
  const dismissalCol = columnIndex("dismissal_time");
  const notesCol = columnIndex("notes");

  if (typeCol === -1 || titleCol === -1 || (dateCol === -1 && (startCol === -1 || endCol === -1))) {
    return {
      ok: false,
      issues: [
        {
          rowIndex: 0,
          message: "CSV must include a title and type column, plus either a date column or start_date/end_date columns.",
        },
      ],
    };
  }

  const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");

  const exceptions: ParsedCalendarException[] = lines.slice(1).map((line) => {
    const row = parseCsvLine(line);
    const start = dateCol !== -1 ? cell(row, dateCol) : cell(row, startCol);
    const end = dateCol !== -1 ? cell(row, dateCol) : cell(row, endCol);
    return {
      startDate: start,
      endDate: end || start,
      type: cell(row, typeCol) as SchoolDayExceptionType,
      title: cell(row, titleCol),
      scheduleProfileKey: cell(row, profileCol) || undefined,
      dismissalTime: cell(row, dismissalCol) || undefined,
      notes: cell(row, notesCol) || undefined,
    };
  });

  return { ok: true, meta: null, exceptions };
}

/** A small, valid example a teacher can start from - matches the CSV shape parseMasterCalendarCsv expects. */
export function buildMasterCalendarCsvTemplate(): string {
  return [
    "start_date,end_date,type,title,schedule_profile,dismissal_time,notes",
    "2026-09-07,2026-09-07,no-school,Labor Day,,,",
    "2026-09-30,2026-09-30,special-bell,Early Release,EARLY_RELEASE,11:24 AM,",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Schedule-profile resolution
// ---------------------------------------------------------------------------

/** Known profile-key aliases baked into Falcon Deck's importer - e.g. the OHHS calendar's generic "REGULAR" token maps to the real OHHS_REGULAR preset automatically, without the user mapping it by hand. */
const KNOWN_PROFILE_ALIASES: Record<string, string> = {
  REGULAR: OHHS_REGULAR_ID,
};

function resolveProfileKeyToScheduleId(profileKey: string, bellSchedules: BellSchedule[]): string | undefined {
  if (bellSchedules.some((s) => s.id === profileKey)) return profileKey;
  const alias = KNOWN_PROFILE_ALIASES[profileKey];
  if (alias && bellSchedules.some((s) => s.id === alias)) return alias;
  return undefined;
}

export interface ProfileMappingResult {
  /** profileKey -> real BellSchedule id, for every key that already resolves to a usable schedule. */
  resolved: Record<string, string>;
  /** Profile keys referenced by a special-bell exception that don't yet resolve to any BellSchedule - these need a "Needs Configuration" placeholder created on commit. */
  unresolvedProfileKeys: string[];
}

export function mapScheduleProfiles(
  exceptions: ParsedCalendarException[],
  bellSchedules: BellSchedule[],
): ProfileMappingResult {
  const resolved: Record<string, string> = {};
  const unresolved = new Set<string>();

  for (const exception of exceptions) {
    if (exception.type !== "special-bell" || !exception.scheduleProfileKey) continue;
    const key = exception.scheduleProfileKey;
    if (resolved[key]) continue;
    const scheduleId = resolveProfileKeyToScheduleId(key, bellSchedules);
    if (scheduleId) {
      resolved[key] = scheduleId;
    } else {
      unresolved.add(key);
    }
  }

  return { resolved, unresolvedProfileKeys: [...unresolved] };
}

function createPlaceholderForProfileKey(profileKey: string, exceptionTitle: string): BellSchedule {
  if (profileKey === OHHS_EARLY_RELEASE_1124_ID) return createOhhsEarlyRelease1124Schedule();
  if (profileKey === OHHS_LAST_DAY_HALF_DAY_ID) return createOhhsLastDayHalfDaySchedule();
  return {
    id: profileKey,
    name: exceptionTitle || profileKey,
    isDefault: false,
    timeZone: "America/Detroit",
    source: "imported",
    needsConfiguration: true,
    blocks: [],
  };
}

// ---------------------------------------------------------------------------
// Preview + conflict detection
// ---------------------------------------------------------------------------

export interface MasterCalendarImportPreview {
  meta: CalendarImportMeta | null;
  totalExceptions: number;
  noSchoolCount: number;
  noStudentsCount: number;
  specialBellCount: number;
  unresolvedProfileKeys: string[];
  conflicts: CalendarImportConflict[];
  exceptions: ParsedCalendarException[];
}

export interface CalendarImportConflict {
  newExceptionIndex: number;
  existingException: SchoolCalendarException;
}

export function detectCalendarConflicts(
  newExceptions: ParsedCalendarException[],
  existingCalendar: SchoolYearCalendar | null,
): CalendarImportConflict[] {
  if (!existingCalendar) return [];
  const conflicts: CalendarImportConflict[] = [];
  newExceptions.forEach((newException, index) => {
    for (const existing of existingCalendar.exceptions) {
      const overlaps = newException.startDate <= existing.endDate && newException.endDate >= existing.startDate;
      if (overlaps) conflicts.push({ newExceptionIndex: index, existingException: existing });
    }
  });
  return conflicts;
}

export function buildMasterCalendarImportPreview(
  meta: CalendarImportMeta | null,
  exceptions: ParsedCalendarException[],
  bellSchedules: BellSchedule[],
  existingCalendar: SchoolYearCalendar | null,
): MasterCalendarImportPreview {
  const profiles = mapScheduleProfiles(exceptions, bellSchedules);
  return {
    meta,
    totalExceptions: exceptions.length,
    noSchoolCount: exceptions.filter((e) => e.type === "no-school").length,
    noStudentsCount: exceptions.filter((e) => e.type === "no-students").length,
    specialBellCount: exceptions.filter((e) => e.type === "special-bell").length,
    unresolvedProfileKeys: profiles.unresolvedProfileKeys,
    conflicts: detectCalendarConflicts(exceptions, existingCalendar),
    exceptions,
  };
}

// ---------------------------------------------------------------------------
// Commit (still pure - produces final data; the caller dispatches it)
// ---------------------------------------------------------------------------

export type CalendarConflictResolution = "skip" | "replace";

export interface CommitMasterCalendarImportResult {
  calendar: SchoolYearCalendar;
  newBellSchedules: BellSchedule[];
}

export function commitMasterCalendarImport({
  meta,
  exceptions,
  existingCalendar,
  bellSchedules,
  conflictResolution,
  generateExceptionId,
  generateCalendarId,
}: {
  meta: CalendarImportMeta | null;
  exceptions: ParsedCalendarException[];
  existingCalendar: SchoolYearCalendar | null;
  bellSchedules: BellSchedule[];
  conflictResolution: CalendarConflictResolution;
  generateExceptionId: () => string;
  generateCalendarId: () => string;
}): CommitMasterCalendarImportResult {
  const conflicts = detectCalendarConflicts(exceptions, existingCalendar);
  const conflictingNewIndices = new Set(conflicts.map((c) => c.newExceptionIndex));

  const profiles = mapScheduleProfiles(exceptions, bellSchedules);
  const newBellSchedules = profiles.unresolvedProfileKeys.map((key) => {
    const related = exceptions.find((e) => e.scheduleProfileKey === key);
    return createPlaceholderForProfileKey(key, related?.title ?? key);
  });
  const allBellSchedules = [...bellSchedules, ...newBellSchedules];

  const importedExceptions: SchoolCalendarException[] = exceptions
    .filter((_, index) => conflictResolution === "replace" || !conflictingNewIndices.has(index))
    .map((e) => ({
      id: generateExceptionId(),
      startDate: e.startDate,
      endDate: e.endDate,
      type: e.type,
      title: e.title,
      sourceScheduleProfile: e.scheduleProfileKey,
      bellScheduleId: e.scheduleProfileKey
        ? resolveProfileKeyToScheduleId(e.scheduleProfileKey, allBellSchedules)
        : undefined,
      dismissalTime: e.dismissalTime,
      notes: e.notes,
    }));

  let baseExceptions = existingCalendar?.exceptions ?? [];
  if (conflictResolution === "replace") {
    const conflictingExistingIds = new Set(conflicts.map((c) => c.existingException.id));
    baseExceptions = baseExceptions.filter((e) => !conflictingExistingIds.has(e.id));
  }

  const defaultBellScheduleId = meta
    ? (resolveProfileKeyToScheduleId(meta.defaultScheduleProfileKey, allBellSchedules) ??
      existingCalendar?.defaultBellScheduleId ??
      "")
    : (existingCalendar?.defaultBellScheduleId ?? "");

  const calendar: SchoolYearCalendar = {
    id: existingCalendar?.id ?? generateCalendarId(),
    name: meta?.name ?? meta?.school ?? existingCalendar?.name ?? "School Calendar",
    schoolYear: meta?.schoolYear ?? existingCalendar?.schoolYear ?? "",
    timeZone: meta?.timeZone ?? existingCalendar?.timeZone ?? "America/Detroit",
    firstStudentDay: meta?.firstStudentDay ?? existingCalendar?.firstStudentDay ?? "",
    lastStudentDay: meta?.lastStudentDay ?? existingCalendar?.lastStudentDay ?? "",
    defaultBellScheduleId,
    exceptions: [...baseExceptions, ...importedExceptions],
  };

  return { calendar, newBellSchedules };
}
