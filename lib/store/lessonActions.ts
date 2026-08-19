import { findLessonForSection } from "@/lib/data/lessons";
import type { AppData } from "@/lib/data/types";
import { addDaysToDateKey } from "@/lib/schedule/localDate";
import type { AgendaItem, Announcement, DailyLesson, LessonResource, ResourceType } from "@/types/lesson";
import { generateId } from "./id";
import type { AppDataAction } from "./actions";

type Dispatch = (action: AppDataAction) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function blankLesson(date: string, classSectionId: string): DailyLesson {
  const timestamp = nowIso();
  return {
    id: generateId("lesson"),
    date,
    classSectionId,
    learningTarget: "",
    agendaItems: [],
    resources: [],
    announcements: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Finds the lesson for (date, classSectionId), or a fresh unsaved one if none exists yet. */
function getOrInitLesson(lessons: DailyLesson[], date: string, classSectionId: string): DailyLesson {
  return findLessonForSection(lessons, date, classSectionId) ?? blankLesson(date, classSectionId);
}

type CopyResult = "copied" | "conflict";

function performCopy(
  data: AppData,
  dispatch: Dispatch,
  sourceLessonId: string,
  destinationClassSectionId: string,
  destinationDate: string,
  overwrite: boolean,
): CopyResult {
  const source = data.lessons.find((lesson) => lesson.id === sourceLessonId);
  if (!source) return "conflict";

  const destination = findLessonForSection(data.lessons, destinationDate, destinationClassSectionId);
  if (destination && !overwrite) return "conflict";

  const timestamp = nowIso();
  const copy: DailyLesson = {
    // Preserve the destination's id when replacing it (a true in-place
    // overwrite); otherwise this is a brand new, independent lesson.
    id: destination ? destination.id : generateId("lesson"),
    date: destinationDate,
    classSectionId: destinationClassSectionId,
    learningTarget: source.learningTarget,
    // Deep copy with regenerated ids - never share a nested object
    // reference (or id) with the source lesson.
    agendaItems: source.agendaItems.map((item) => ({ ...item, id: generateId("agenda") })),
    resources: source.resources.map((resource) => ({ ...resource, id: generateId("resource") })),
    announcements: source.announcements.map((note) => ({ ...note, id: generateId("announcement") })),
    createdAt: destination ? destination.createdAt : timestamp,
    updatedAt: timestamp,
  };

  dispatch({ type: "UPSERT_LESSON", lesson: copy });
  return "copied";
}

export interface LessonActions {
  /** Idempotent: returns the existing lesson for (date, classSectionId), or creates a blank one. */
  createLesson: (date: string, classSectionId: string) => DailyLesson;
  deleteLesson: (lessonId: string) => void;

  updateLearningTarget: (date: string, classSectionId: string, learningTarget: string) => void;

  addAgendaItem: (date: string, classSectionId: string, title: string) => void;
  updateAgendaItem: (
    date: string,
    classSectionId: string,
    itemId: string,
    patch: Partial<Pick<AgendaItem, "title" | "details">>,
  ) => void;
  deleteAgendaItem: (date: string, classSectionId: string, itemId: string) => void;
  reorderAgendaItem: (
    date: string,
    classSectionId: string,
    itemId: string,
    direction: "up" | "down",
  ) => void;
  toggleAgendaItemCompleted: (date: string, classSectionId: string, itemId: string) => void;

  addResource: (
    date: string,
    classSectionId: string,
    resource: { title: string; url: string; type: ResourceType },
  ) => void;
  updateResource: (
    date: string,
    classSectionId: string,
    resourceId: string,
    patch: Partial<Pick<LessonResource, "title" | "url" | "type">>,
  ) => void;
  deleteResource: (date: string, classSectionId: string, resourceId: string) => void;

  addAnnouncement: (date: string, classSectionId: string, text: string) => void;
  updateAnnouncement: (
    date: string,
    classSectionId: string,
    announcementId: string,
    text: string,
  ) => void;
  deleteAnnouncement: (date: string, classSectionId: string, announcementId: string) => void;

  /** Same section, next calendar date. Fails with "conflict" if that date already has a lesson. */
  copyLessonToTomorrow: (lessonId: string) => CopyResult;
  /** Fails with "conflict" unless `options.overwrite` is set, so callers must confirm before replacing. */
  copyLessonToSection: (
    lessonId: string,
    destinationClassSectionId: string,
    destinationDate: string,
    options?: { overwrite?: boolean },
  ) => CopyResult;
}

/**
 * Builds the lesson slice of `AppDataActions`. Every mutator here finds (or
 * synthesizes) the target lesson, computes the next value, and dispatches a
 * single `UPSERT_LESSON` - the reducer just replaces-or-inserts by id, all
 * the "find the right lesson" / "create it if it doesn't exist yet" logic
 * lives in this one place, same as `AppDataProvider`'s schedule actions.
 */
export function createLessonActions(data: AppData, dispatch: Dispatch): LessonActions {
  function upsert(lesson: DailyLesson) {
    dispatch({ type: "UPSERT_LESSON", lesson: { ...lesson, updatedAt: nowIso() } });
    return lesson;
  }

  return {
    createLesson(date, classSectionId) {
      const existing = findLessonForSection(data.lessons, date, classSectionId);
      if (existing) return existing;
      const lesson = blankLesson(date, classSectionId);
      dispatch({ type: "UPSERT_LESSON", lesson });
      return lesson;
    },

    deleteLesson(lessonId) {
      dispatch({ type: "DELETE_LESSON", lessonId });
    },

    updateLearningTarget(date, classSectionId, learningTarget) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      upsert({ ...lesson, learningTarget });
    },

    addAgendaItem(date, classSectionId, title) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      const item: AgendaItem = {
        id: generateId("agenda"),
        title,
        isCompleted: false,
        sortOrder: lesson.agendaItems.length,
      };
      upsert({ ...lesson, agendaItems: [...lesson.agendaItems, item] });
    },

    updateAgendaItem(date, classSectionId, itemId, patch) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      upsert({
        ...lesson,
        agendaItems: lesson.agendaItems.map((item) =>
          item.id === itemId ? { ...item, ...patch } : item,
        ),
      });
    },

    deleteAgendaItem(date, classSectionId, itemId) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      const remaining = lesson.agendaItems
        .filter((item) => item.id !== itemId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item, index) => ({ ...item, sortOrder: index }));
      upsert({ ...lesson, agendaItems: remaining });
    },

    reorderAgendaItem(date, classSectionId, itemId, direction) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      const items = [...lesson.agendaItems].sort((a, b) => a.sortOrder - b.sortOrder);
      const index = items.findIndex((item) => item.id === itemId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || targetIndex < 0 || targetIndex >= items.length) return;
      [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
      upsert({ ...lesson, agendaItems: items.map((item, i) => ({ ...item, sortOrder: i })) });
    },

    toggleAgendaItemCompleted(date, classSectionId, itemId) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      upsert({
        ...lesson,
        agendaItems: lesson.agendaItems.map((item) =>
          item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item,
        ),
      });
    },

    addResource(date, classSectionId, resource) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      const newResource: LessonResource = { id: generateId("resource"), ...resource };
      upsert({ ...lesson, resources: [...lesson.resources, newResource] });
    },

    updateResource(date, classSectionId, resourceId, patch) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      upsert({
        ...lesson,
        resources: lesson.resources.map((resource) =>
          resource.id === resourceId ? { ...resource, ...patch } : resource,
        ),
      });
    },

    deleteResource(date, classSectionId, resourceId) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      upsert({ ...lesson, resources: lesson.resources.filter((r) => r.id !== resourceId) });
    },

    addAnnouncement(date, classSectionId, text) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      const announcement: Announcement = { id: generateId("announcement"), text };
      upsert({ ...lesson, announcements: [...lesson.announcements, announcement] });
    },

    updateAnnouncement(date, classSectionId, announcementId, text) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      upsert({
        ...lesson,
        announcements: lesson.announcements.map((note) =>
          note.id === announcementId ? { ...note, text } : note,
        ),
      });
    },

    deleteAnnouncement(date, classSectionId, announcementId) {
      const lesson = getOrInitLesson(data.lessons, date, classSectionId);
      upsert({
        ...lesson,
        announcements: lesson.announcements.filter((note) => note.id !== announcementId),
      });
    },

    copyLessonToTomorrow(lessonId) {
      const source = data.lessons.find((lesson) => lesson.id === lessonId);
      if (!source) return "conflict";
      return performCopy(
        data,
        dispatch,
        lessonId,
        source.classSectionId,
        addDaysToDateKey(source.date, 1),
        false,
      );
    },

    copyLessonToSection(lessonId, destinationClassSectionId, destinationDate, options) {
      return performCopy(
        data,
        dispatch,
        lessonId,
        destinationClassSectionId,
        destinationDate,
        options?.overwrite ?? false,
      );
    },
  };
}
