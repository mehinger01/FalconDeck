import type { BellSchedule } from "@/types/schedule";
import type { SchoolCalendarException, SchoolDateResolution, SchoolYearCalendar } from "@/types/calendar";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import { weekdayForDateKey } from "@/lib/schedule/localDate";
import { resolveActiveSchedule } from "@/lib/schedule/resolveActiveSchedule";
import { resolveTeacherSchedule } from "@/lib/schedule/resolveTeacherSchedule";

function findExceptionsForDate(calendar: SchoolYearCalendar, dateKey: string): SchoolCalendarException[] {
  return calendar.exceptions.filter((exception) => dateKey >= exception.startDate && dateKey <= exception.endDate);
}

function isUsableSchedule(schedule: BellSchedule | null | undefined): schedule is BellSchedule {
  return Boolean(schedule) && !schedule!.needsConfiguration && schedule!.blocks.length > 0;
}

function resolveRegular(
  dateKey: string,
  status: "regular" | "special-schedule",
  bellSchedule: BellSchedule,
  teacherPreferences: TeacherSchedulePreferences,
  title?: string,
  exception?: SchoolCalendarException,
): SchoolDateResolution {
  return {
    dateKey,
    status,
    bellSchedule,
    resolvedTeacherSchedule: resolveTeacherSchedule(bellSchedule, teacherPreferences),
    title,
    exception,
  };
}

/**
 * The single authoritative "what is this date" answer, layered above the
 * existing schedule engine (getPresentationState et al. still take a plain
 * BellSchedule and know nothing about calendars). Deterministic precedence
 * regardless of exception array order: NO_SCHOOL > NO_STUDENTS >
 * SPECIAL_BELL > (weekend | regular).
 *
 * Both "regular" branches below - no Master Calendar configured at all, and
 * an ordinary instructional day within a configured calendar - resolve
 * through the SAME single call to resolveActiveSchedule(), computed once,
 * up front, and reused everywhere a "regular" day needs a schedule. This is
 * deliberate, not incidental: teacherSchedulePreferences.activeBellScheduleId
 * is the only source of truth for "which schedule does this teacher use on
 * an ordinary day," calendar-configured or not - never a schedule's own
 * `isDefault` flag, and never calendar.defaultBellScheduleId (that field
 * stays in the schema/type for legacy/calendar-metadata purposes only - see
 * MasterCalendarScreen's own summary display - but must never become a
 * second, competing source of truth for the teacher's ordinary active
 * schedule). A date-specific SPECIAL_BELL exception is the one legitimate
 * way a specific date resolves a DIFFERENT schedule than the teacher's
 * active one - that's an explicit calendar exception for that date, not a
 * competing default, and is resolved independently below, unchanged. A null
 * active schedule (no explicit selection made yet) correctly produces
 * `unconfigured-schedule` with a null `bellSchedule`, the same status a
 * schedule with no block times produces - both mean "nothing usable to
 * show," and downstream UI (see LivePresentScreen.tsx) already handles that
 * status.
 */
export function resolveSchoolDate({
  dateKey,
  calendar,
  bellSchedules,
  teacherPreferences,
}: {
  dateKey: string;
  calendar: SchoolYearCalendar | null;
  bellSchedules: BellSchedule[];
  teacherPreferences: TeacherSchedulePreferences;
}): SchoolDateResolution {
  const activeSchedule = resolveActiveSchedule(bellSchedules, teacherPreferences);

  if (!calendar) {
    if (!isUsableSchedule(activeSchedule)) {
      return { dateKey, status: "unconfigured-schedule", bellSchedule: activeSchedule ?? null };
    }
    return resolveRegular(dateKey, "regular", activeSchedule, teacherPreferences);
  }

  // An empty bound means "not known yet" (e.g. a calendar built purely
  // from a CSV import, which carries no school-year metadata), not "every
  // date is out of range" - only reject when a real bound exists and the
  // date actually falls outside it.
  const beforeFirstDay = calendar.firstStudentDay.length > 0 && dateKey < calendar.firstStudentDay;
  const afterLastDay = calendar.lastStudentDay.length > 0 && dateKey > calendar.lastStudentDay;
  if (beforeFirstDay || afterLastDay) {
    return { dateKey, status: "outside-school-year", bellSchedule: null };
  }

  const matching = findExceptionsForDate(calendar, dateKey);

  const noSchool = matching.find((e) => e.type === "no-school");
  if (noSchool) {
    return { dateKey, status: "no-school", bellSchedule: null, title: noSchool.title, exception: noSchool };
  }

  const noStudents = matching.find((e) => e.type === "no-students");
  if (noStudents) {
    return { dateKey, status: "no-students", bellSchedule: null, title: noStudents.title, exception: noStudents };
  }

  const specialBell = matching.find((e) => e.type === "special-bell");
  if (specialBell) {
    const schedule = specialBell.bellScheduleId
      ? (bellSchedules.find((s) => s.id === specialBell.bellScheduleId) ?? null)
      : null;
    if (!isUsableSchedule(schedule)) {
      return {
        dateKey,
        status: "unconfigured-schedule",
        bellSchedule: schedule,
        title: specialBell.title,
        exception: specialBell,
      };
    }
    return resolveRegular(dateKey, "special-schedule", schedule, teacherPreferences, specialBell.title, specialBell);
  }

  const weekday = weekdayForDateKey(dateKey);
  if (weekday === "saturday" || weekday === "sunday") {
    return { dateKey, status: "weekend", bellSchedule: null };
  }

  // An ordinary instructional day (configured calendar, no matching
  // exception) - resolves through the SAME activeSchedule computed once at
  // the top of this function. calendar.defaultBellScheduleId is
  // deliberately never read here (see this function's own doc comment).
  if (!isUsableSchedule(activeSchedule)) {
    return { dateKey, status: "unconfigured-schedule", bellSchedule: activeSchedule ?? null };
  }
  return resolveRegular(dateKey, "regular", activeSchedule, teacherPreferences);
}
