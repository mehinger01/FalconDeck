/**
 * Phase 1 lesson import file format - JSON only, teacher/AI-friendly, and
 * deliberately smaller than `DailyLesson`: it carries no ids, no section
 * (a course's active sections are resolved at import time), and no
 * resources/announcements (Falcon Deck has no way to safely infer those
 * from plain text). See `lib/lessons/import/lessonImport.ts` for the
 * parse -> validate -> match -> preview -> commit pipeline this schema
 * feeds.
 */

export const LESSON_IMPORT_SCHEMA_VERSION = 1;

/** The raw shape a teacher (or an AI helping them) authors, one entry per lesson. */
export interface LessonImportFileRow {
  date: string;
  course: string;
  learningTarget?: string;
  what?: string;
  how?: string;
  why?: string;
  materials?: string;
}

export interface LessonImportFile {
  version: number;
  lessons: LessonImportFileRow[];
}
