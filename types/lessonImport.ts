/**
 * Phase 1 lesson import file format - JSON only, teacher/AI-friendly, and
 * deliberately smaller than `DailyLesson`: it carries no ids and no
 * section (a course's active sections are resolved at import time). See
 * `lib/lessons/import/lessonImport.ts` for the parse -> validate -> match
 * -> preview -> commit pipeline this schema feeds.
 *
 * What/How/Why/Materials can be authored either way:
 *   - flat string fields (`what`/`how`/`why`/`materials`), or
 *   - a Falcon Deck-shaped `agendaItems` array (`{title, details}`, title
 *     matched case-insensitively against what/how/why/materials) - the
 *     shape real AI-generated packages tend to produce, since it mirrors
 *     `DailyLesson.agendaItems` directly. A row may mix both; flat fields
 *     win if both are present for the same slot. See
 *     `extractWhatHowWhyMaterials` for the exact merge order.
 *
 * `announcements` (plain strings) is a deliberate, opt-in exception to
 * "smaller than DailyLesson": resources/announcements are otherwise never
 * read from an import file (Falcon Deck has no way to safely infer
 * resources from plain text, and importing announcements is disabled by
 * default) - see the "Import announcements" checkbox in the review step
 * and `commitLessonImport`'s append-and-dedupe-only handling.
 */

export const LESSON_IMPORT_SCHEMA_VERSION = 1;

export interface LessonImportFileAgendaItem {
  title: string;
  details?: string;
  /** Accepted for compatibility with packages that number their own steps; Falcon Deck re-derives its own sortOrder regardless. */
  sortOrder?: number;
}

/** The raw shape a teacher (or an AI helping them) authors, one entry per lesson. */
export interface LessonImportFileRow {
  date: string;
  course: string;
  learningTarget?: string;
  what?: string;
  how?: string;
  why?: string;
  materials?: string;
  agendaItems?: LessonImportFileAgendaItem[];
  /** Opt-in only - see the "Import announcements" checkbox. Ignored entirely unless the teacher enables it. */
  announcements?: string[];
}

export interface LessonImportFile {
  version: number;
  lessons: LessonImportFileRow[];
}
