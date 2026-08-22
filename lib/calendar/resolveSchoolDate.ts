import type { BellSchedule } from "@/types/schedule";
import type { SchoolCalendarException, SchoolDateResolution, SchoolYearCalendar } from "@/types/calendar";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import { weekdayForDateKey } from "@/lib/schedule/localDate";
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
 * SPECIAL_BELL > (weekend | regular). A `calendar` of `null` is a fully
 * supported "no Master Calendar configured yet" state - Master Calendar is
 * optional, so this falls back to whichever BellSchedule is marked default.
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
  if (!calendar) {
    const defaultSchedule = bellSchedules.find((s) => s.isDefault) ?? bellSchedules[0] ?? null;
    if (!isUsableSchedule(defaultSchedule)) {
      return { dateKey, status: "unconfigured-schedule", bellSchedule: defaultSchedule ?? null };
    }
    return resolveRegular(dateKey, "regular", defaultSchedule, teacherPreferences);
  }

  if (dateKey < calendar.firstStudentDay || dateKey > calendar.lastStudentDay) {
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

  const defaultSchedule = bellSchedules.find((s) => s.id === calendar.defaultBellScheduleId) ?? null;
  if (!isUsableSchedule(defaultSchedule)) {
    return { dateKey, status: "unconfigured-schedule", bellSchedule: defaultSchedule ?? null };
  }
  return resolveRegular(dateKey, "regular", defaultSchedule, teacherPreferences);
}
