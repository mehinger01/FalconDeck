-- Falcon Deck Teacher Transition Content initiative - Stage B, migration 1 of 2.
-- Adds the canonical warm-up field alongside the existing `materials`
-- free-text field on `lessons` (see the transition-content design report's
-- Section B/H and types/lesson.ts's own doc comment on DailyLesson.warmup).
--
-- Nullable, no default, no backfill, no data rewrite: every existing
-- lessons row is completely unaffected - `warmup` is simply absent (NULL)
-- until a teacher enters one, exactly the same treatment `materials` got
-- when IT was added after the table already had production rows (see
-- 20260914130100_lessons.sql's own "Added post-lock" comment for the same
-- pattern). No RLS change needed - policies apply per-row, not per-column,
-- and lessons_select/insert/update/delete already cover every column on
-- this table, this one included.

alter table public.lessons add column warmup text;
