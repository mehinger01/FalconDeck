import type { AppData } from "@/lib/data/types";
import type { ClassSection, Course } from "@/types/course";
import type { BellSchedule, ScheduleBlock, ScheduleBlockOverride, Weekday } from "@/types/schedule";

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
  | { type: "ADD_CLASS_SECTION"; section: ClassSection };
