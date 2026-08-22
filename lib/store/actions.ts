import type { AppData } from "@/lib/data/types";
import type { ClassSection, Course } from "@/types/course";
import type { DailyLesson } from "@/types/lesson";
import type { BellSchedule, ScheduleBlock, ScheduleBlockOverride, Weekday } from "@/types/schedule";
import type { ClassroomExperienceSettings } from "@/types/classPresentation";
import type { LibraryResource } from "@/types/resource";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import type { SchoolCalendarException, SchoolYearCalendar } from "@/types/calendar";

export type AppDataAction =
  | { type: "HYDRATE"; data: AppData }
  | { type: "RESET_TO_DEMO" }
  | { type: "ADD_SCHEDULE"; schedule: BellSchedule }
  | { type: "DUPLICATE_SCHEDULE"; scheduleId: string; newId: string; newName: string }
  | { type: "DELETE_SCHEDULE"; scheduleId: string }
  | { type: "RENAME_SCHEDULE"; scheduleId: string; name: string }
  | { type: "SET_DEFAULT_SCHEDULE"; scheduleId: string }
  | { type: "ADD_BLOCK"; scheduleId: string; block: ScheduleBlock }
  | {
      type: "UPDATE_BLOCK";
      scheduleId: string;
      blockId: string;
      patch: Partial<Omit<ScheduleBlock, "id" | "overrides">>;
    }
  | { type: "DELETE_BLOCK"; scheduleId: string; blockId: string }
  | { type: "MOVE_BLOCK"; scheduleId: string; blockId: string; direction: "up" | "down" }
  | { type: "SET_BLOCK_OVERRIDE"; scheduleId: string; blockId: string; override: ScheduleBlockOverride }
  | { type: "REMOVE_BLOCK_OVERRIDE"; scheduleId: string; blockId: string; weekday: Weekday }
  | { type: "ADD_COURSE"; course: Course }
  | { type: "ADD_CLASS_SECTION"; section: ClassSection }
  | { type: "UPSERT_LESSON"; lesson: DailyLesson }
  | { type: "DELETE_LESSON"; lessonId: string }
  | { type: "SET_ARRIVAL_INSTRUCTIONS"; classSectionId: string; instructions: string[] }
  | { type: "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS"; patch: Partial<ClassroomExperienceSettings> }
  | { type: "UPSERT_LIBRARY_RESOURCE"; resource: LibraryResource }
  | { type: "DELETE_LIBRARY_RESOURCE"; resourceId: string }
  | { type: "UPDATE_TEACHER_SCHEDULE_PREFERENCES"; patch: Partial<TeacherSchedulePreferences> }
  | { type: "IMPORT_MASTER_CALENDAR"; calendar: SchoolYearCalendar; newBellSchedules: BellSchedule[] }
  | { type: "ADD_CALENDAR_EXCEPTION"; exception: SchoolCalendarException }
  | { type: "UPDATE_CALENDAR_EXCEPTION"; exceptionId: string; patch: Partial<Omit<SchoolCalendarException, "id">> }
  | { type: "DELETE_CALENDAR_EXCEPTION"; exceptionId: string };
