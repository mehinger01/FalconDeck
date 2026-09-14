/**
 * Standalone verification for Phase 1's Lesson Import system
 * (`lib/lessons/import/lessonImport.ts` + the wizard in
 * `components/settings/LessonImportScreen.tsx`).
 *
 * Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:lesson-import
 *
 * Everything through `commitLessonImport` is pure logic (no React, no
 * repository), so it's exercised directly here. The one thing that can't
 * be exercised without a DOM - the UI never reporting success on a
 * repository save failure - is confirmed with a targeted static-source
 * check, matching this project's established pattern for verifying
 * React-component wiring without a DOM renderer (see verify-calendar.ts).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildLessonImportPreview,
  commitLessonImport,
  normalizeCourseNameKey,
  parseLessonImportJson,
  type LessonImportPreview,
} from "@/lib/lessons/import/lessonImport";
import { findLessonForSection } from "@/lib/data/lessons";
import type { Course, ClassSection } from "@/types/course";
import type { DailyLesson } from "@/types/lesson";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const courses: Course[] = [
  { id: "course-algebra", name: "Algebra 1" },
  { id: "course-geometry", name: "Geometry" },
  { id: "course-enrichment", name: "Enrichment" },
];
const classSections: ClassSection[] = [
  { id: "section-alg-p1", courseId: "course-algebra", name: "Algebra 1 - P1" },
  { id: "section-alg-p3", courseId: "course-algebra", name: "Algebra 1 - P3" },
  { id: "section-geo-p2", courseId: "course-geometry", name: "Geometry - P2" },
  { id: "section-enrichment-p7", courseId: "course-enrichment", name: "Enrichment - P7" },
];

let idCounter = 0;
function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
const now = () => "2026-09-01T00:00:00.000Z";

function preview(
  raw: string,
  existingLessons: DailyLesson[],
  courseNameOverrides: Record<string, string> = {},
): LessonImportPreview {
  const parsed = parseLessonImportJson(raw);
  if (!parsed.ok) throw new Error("expected parse to succeed in this helper");
  return buildLessonImportPreview(parsed.rows, courses, classSections, existingLessons, courseNameOverrides);
}

console.log("1. Valid one-lesson import");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [
      {
        date: "2026-09-15",
        course: "Algebra 1",
        learningTarget: "I can solve two-step equations.",
        what: "What content",
        how: "How content",
        why: "Why content",
        materials: "Textbook pp. 1-2",
      },
    ],
  });
  const p = preview(file, []);
  check("1a: no invalid rows", p.invalidCount === 0);
  check("1b: no unmatched courses", p.unmatchedCourseCount === 0);
  check("1c: one ready row", p.readyCount === 1);
  check("1d: row targets both Algebra sections", p.rows[0].sectionIds.length === 2);

  const commit = commitLessonImport({ preview: p, resolutions: {}, existingLessons: [], generateId: genId, now });
  check("1e: creates one lesson per active section", commit.lessons.length === 2);
  check("1f: outcome is 'imported'", commit.results[0]?.outcome === "imported");

  const l1 = findLessonForSection(commit.lessons, "2026-09-15", "section-alg-p1");
  check("1g: learningTarget carried over", l1?.learningTarget === "I can solve two-step equations.");
  check("1h: materials carried over", l1?.materials === "Textbook pp. 1-2");
  check("1i: what/how/why became 3 agenda items", l1?.agendaItems.length === 3);
  check("1j: fresh lessons start with no resources/announcements", l1?.resources.length === 0 && l1?.announcements.length === 0);
}

console.log("\n2. Multiple lessons (different courses/dates)");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [
      { date: "2026-09-15", course: "Algebra 1", learningTarget: "Algebra target" },
      { date: "2026-09-16", course: "Geometry", learningTarget: "Geometry target" },
    ],
  });
  const p = preview(file, []);
  check("2a: both rows ready", p.readyCount === 2);
  const commit = commitLessonImport({ preview: p, resolutions: {}, existingLessons: [], generateId: genId, now });
  // 2 Algebra sections + 1 Geometry section
  check("2b: fans out across all active sections", commit.lessons.length === 3);
}

console.log("\n3. Invalid JSON");
{
  const parsed = parseLessonImportJson("{ this is not json");
  check("3a: parse fails", parsed.ok === false);
  check("3b: no stack trace leaked, just a plain message", !parsed.ok && parsed.issues[0] === "That file isn't valid JSON.");
}

console.log("\n4. Missing required field (date)");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [{ course: "Algebra 1", learningTarget: "Missing a date" }],
  });
  const p = preview(file, []);
  check("4a: row is invalid", p.rows[0].kind === "invalid");
  check("4b: understandable message", p.rows[0].issues.some((m) => m === "Row 1 is missing a date."));
}

console.log("\n5. Invalid date");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [{ date: "2026-13-40", course: "Algebra 1", learningTarget: "Bad date" }],
  });
  const p = preview(file, []);
  check("5a: row is invalid", p.rows[0].kind === "invalid");
  check("5b: message names the bad value", p.rows[0].issues.some((m) => m.includes("2026-13-40")));
}

console.log("\n6. Unknown course");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [{ date: "2026-09-15", course: "Chemistry", learningTarget: "No such course" }],
  });
  const p = preview(file, []);
  check("6a: row flagged unmatched-course", p.rows[0].kind === "unmatched-course");
  check("6b: not silently created or fuzzy-matched", p.rows[0].courseId === null);
}

console.log("\n7. Duplicate lesson inside import file");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [
      { date: "2026-09-15", course: "Geometry", learningTarget: "First" },
      { date: "2026-09-15", course: "Geometry", learningTarget: "Second" },
    ],
  });
  const p = preview(file, []);
  check("7a: first occurrence stays ready", p.rows[0].kind === "ready");
  check("7b: second occurrence flagged invalid", p.rows[1].kind === "invalid");
  check(
    "7c: understandable duplicate message",
    p.rows[1].kind === "invalid" && p.rows[1].issues.some((m) => m.includes("appears twice for Geometry")),
  );
}

console.log("\n8. Existing lesson + Skip");
{
  const existing: DailyLesson = {
    id: "lesson-existing-1",
    date: "2026-09-15",
    classSectionId: "section-alg-p1",
    learningTarget: "Original target",
    agendaItems: [],
    resources: [{ id: "r1", title: "Slides", url: "https://example.com", type: "slides" }],
    announcements: [{ id: "a1", text: "Quiz Friday" }],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const file = JSON.stringify({
    version: 1,
    lessons: [{ date: "2026-09-15", course: "Algebra 1", learningTarget: "Imported target" }],
  });
  const p = preview(file, [existing]);
  check("8a: row flagged as a conflict", p.rows[0].kind === "ready" && p.rows[0].conflict === true);

  const commit = commitLessonImport({
    preview: p,
    resolutions: { 0: "skip" },
    existingLessons: [existing],
    generateId: genId,
    now,
  });
  const l1 = findLessonForSection(commit.lessons, "2026-09-15", "section-alg-p1");
  check("8b: existing lesson content untouched", l1?.learningTarget === "Original target");
  const l3 = findLessonForSection(commit.lessons, "2026-09-15", "section-alg-p3");
  check("8c: skip applies to every section of this course/date, no new lesson created", l3 === null);
  check("8d: outcome is 'skipped'", commit.results[0]?.outcome === "skipped");
}

console.log("\n9. Existing lesson + Replace");
{
  const existing: DailyLesson = {
    id: "lesson-existing-2",
    date: "2026-09-15",
    classSectionId: "section-alg-p1",
    learningTarget: "Original target",
    agendaItems: [],
    resources: [{ id: "r1", title: "Slides", url: "https://example.com", type: "slides" }],
    announcements: [{ id: "a1", text: "Quiz Friday" }],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const file = JSON.stringify({
    version: 1,
    lessons: [{ date: "2026-09-15", course: "Algebra 1", learningTarget: "Imported target", what: "New what" }],
  });
  const p = preview(file, [existing]);
  const commit = commitLessonImport({
    preview: p,
    resolutions: { 0: "replace" },
    existingLessons: [existing],
    generateId: genId,
    now,
  });
  const l1 = findLessonForSection(commit.lessons, "2026-09-15", "section-alg-p1");
  check("9a: content replaced with imported values", l1?.learningTarget === "Imported target");
  check("9b: existing lesson id preserved", l1?.id === "lesson-existing-2");
  check("9c: createdAt preserved", l1?.createdAt === "2026-08-01T00:00:00.000Z");
  check(
    "9d: resources/announcements untouched (import format has no opinion on them)",
    l1?.resources.length === 1 && l1?.announcements.length === 1,
  );
  const l3 = findLessonForSection(commit.lessons, "2026-09-15", "section-alg-p3");
  check("9e: non-conflicting sibling section also gets the imported content", l3?.learningTarget === "Imported target");
}

console.log("\n10. Existing lesson + Merge");
{
  const existing: DailyLesson = {
    id: "lesson-existing-3",
    date: "2026-09-15",
    classSectionId: "section-alg-p1",
    learningTarget: "Original target (nonblank)",
    agendaItems: [],
    resources: [],
    announcements: [],
    materials: undefined,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const file = JSON.stringify({
    version: 1,
    lessons: [
      { date: "2026-09-15", course: "Algebra 1", learningTarget: "Imported target", materials: "Imported materials" },
    ],
  });
  const p = preview(file, [existing]);
  const commit = commitLessonImport({
    preview: p,
    resolutions: { 0: "merge" },
    existingLessons: [existing],
    generateId: genId,
    now,
  });
  const l1 = findLessonForSection(commit.lessons, "2026-09-15", "section-alg-p1");
  check("10a: nonblank existing field preserved", l1?.learningTarget === "Original target (nonblank)");
  check("10b: blank existing field filled from import", l1?.materials === "Imported materials");
  check("10c: existing lesson id preserved", l1?.id === "lesson-existing-3");
}

console.log("\n11. Multiple sections of the same course");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [{ date: "2026-09-20", course: "Algebra 1", learningTarget: "Shared content" }],
  });
  const p = preview(file, []);
  const commit = commitLessonImport({ preview: p, resolutions: {}, existingLessons: [], generateId: genId, now });
  const l1 = findLessonForSection(commit.lessons, "2026-09-20", "section-alg-p1");
  const l3 = findLessonForSection(commit.lessons, "2026-09-20", "section-alg-p3");
  check("11a: both sections got their own lesson", l1 !== null && l3 !== null);
  check("11b: independent ids, not a shared row", l1?.id !== l3?.id);
  check("11c: same imported content", l1?.learningTarget === "Shared content" && l3?.learningTarget === "Shared content");
}

console.log("\n12. Retry does not generate duplicate lessons");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [{ date: "2026-09-21", course: "Geometry", learningTarget: "Idempotency check" }],
  });

  const firstPreview = preview(file, []);
  const firstCommit = commitLessonImport({
    preview: firstPreview,
    resolutions: {},
    existingLessons: [],
    generateId: genId,
    now,
  });
  check("12a: first run creates exactly one lesson", firstCommit.lessons.length === 1);

  // Retry against the state the first run produced, with no explicit
  // resolution (the required default: Skip).
  const secondPreview = preview(file, firstCommit.lessons);
  check("12b: retry sees a conflict", secondPreview.rows[0].kind === "ready" && secondPreview.rows[0].conflict === true);
  const secondCommit = commitLessonImport({
    preview: secondPreview,
    resolutions: {},
    existingLessons: firstCommit.lessons,
    generateId: genId,
    now,
  });
  check("12c: retry does not add a duplicate", secondCommit.lessons.length === 1);
  check("12d: retry outcome is 'skipped'", secondCommit.results[0]?.outcome === "skipped");

  // An explicit Replace on retry updates the same row in place too.
  const thirdCommit = commitLessonImport({
    preview: secondPreview,
    resolutions: { 0: "replace" },
    existingLessons: firstCommit.lessons,
    generateId: genId,
    now,
  });
  check("12e: explicit replace on retry still yields exactly one lesson", thirdCommit.lessons.length === 1);
  check("12f: same id reused, not a new row", thirdCommit.lessons[0].id === firstCommit.lessons[0].id);
}

console.log("\n13. Manual course-name mapping (unmatched -> existing course)");
{
  const file = JSON.stringify({
    version: 1,
    lessons: [
      { date: "2026-09-22", course: "Intervention 10 Math", learningTarget: "First section" },
      { date: "2026-09-23", course: "Intervention 10 Math", learningTarget: "Second date, same name" },
      { date: "2026-09-25", course: "intervention 10 MATH  ", learningTarget: "Case/whitespace-insensitive match" },
    ],
  });

  const unmapped = preview(file, []);
  check("13a: unmapped rows are flagged unmatched-course", unmapped.rows.every((r) => r.kind === "unmatched-course"));

  const key = normalizeCourseNameKey("Intervention 10 Math");
  const mapped = preview(file, [], { [key]: "course-enrichment" });
  check("13b: mapping applies to every row sharing the name (including case/whitespace variants)", mapped.rows.every((r) => r.kind === "ready"));
  check("13c: matched course is the mapped one", mapped.rows.every((r) => r.courseId === "course-enrichment"));

  const commit = commitLessonImport({ preview: mapped, resolutions: {}, existingLessons: [], generateId: genId, now });
  check("13d: lessons land in the mapped course's active sections", commit.lessons.every((l) => l.classSectionId === "section-enrichment-p7"));

  // An explicit exact-name match always wins over a manual override, so a
  // mapping can never shadow a real course that already exists.
  const withRealMatch = preview(
    JSON.stringify({ version: 1, lessons: [{ date: "2026-09-24", course: "Algebra 1", learningTarget: "x" }] }),
    [],
    { [normalizeCourseNameKey("Algebra 1")]: "course-enrichment" },
  );
  check("13e: automatic exact match takes priority over any override", withRealMatch.rows[0].courseId === "course-algebra");
}

console.log("\n14. Repository failure does not falsely report success");
{
  const source = readFileSync(join(process.cwd(), "components/settings/LessonImportScreen.tsx"), "utf8");
  check(
    "14a: wizard has a distinct save-error step, not just an optimistic success",
    source.includes('step: "save-error"'),
  );
  check(
    "14b: success step is only reached after persistence confirms 'saved'",
    /persistence\.status === "saved"[\s\S]{0,80}setState\(\{\s*step: "results"/.test(source),
  );
  check(
    "14c: a failed save routes to save-error instead of results",
    /else\s*\{\s*setState\(\{\s*step: "save-error"/.test(source),
  );
  check(
    "14d: waits for a NEW save (this import's own), not a stale/unrelated one",
    source.includes("persistence.attempt > state.saveAttemptBaseline"),
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
