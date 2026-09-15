"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { generateId } from "@/lib/store/id";
import { formatDateKeyLong } from "@/lib/schedule/localDate";
import {
  buildLessonImportPreview,
  commitLessonImport,
  matchImportedCourses,
  normalizeCourseNameKey,
  parseLessonImportJson,
  type LessonImportConflictResolution,
  type LessonImportPreview,
  type LessonImportRow,
  type LessonImportRowOutcome,
  type LessonImportRowPreview,
  type LessonImportRowResult,
} from "@/lib/lessons/import/lessonImport";

type WizardState =
  | { step: "select" }
  | { step: "parse-error"; issues: string[] }
  | {
      step: "review";
      rows: LessonImportRow[];
      resolutions: Record<number, LessonImportConflictResolution>;
      /** Keyed by `normalizeCourseNameKey` - a teacher's manual "map this unmatched name to this course" choice, applied to every row that used the same name. */
      courseMappings: Record<string, string>;
      /** Off by default - announcements are parsed and previewable regardless, but never written unless this is checked. */
      importAnnouncements: boolean;
    }
  | {
      step: "pending-save";
      results: LessonImportRowResult[];
      preview: LessonImportPreview;
      saveAttemptBaseline: number;
    }
  | {
      step: "results";
      results: LessonImportRowResult[];
      preview: LessonImportPreview;
    }
  | { step: "save-error"; message: string };

const RESOLUTION_LABELS: Record<LessonImportConflictResolution, string> = {
  skip: "Skip — keep the existing lesson",
  replace: "Replace with the imported lesson",
  merge: "Merge — fill blanks only",
};

function unmatchedReason(row: LessonImportRowPreview): string {
  if (row.kind === "unmatched-course") {
    return `"${row.row.course}" could not be matched to an existing Falcon Deck course.`;
  }
  if (row.kind === "no-active-sections") {
    return `This course has no active class sections to import into.`;
  }
  return "";
}

function sectionCountLabel(count: number): string {
  return `${count} section${count === 1 ? "" : "s"}`;
}

/**
 * Select File -> Validate -> Match -> Detect Conflicts -> Preview -> Import
 * -> Results. Nothing in `lib/lessons/import/lessonImport.ts` ever touches
 * AppData - this component is the only place that reads a file or
 * dispatches. Mirrors `MasterCalendarImportPanel`'s parse/validate/preview/
 * commit flow, but waits for real persistence confirmation before
 * declaring success (see the `pending-save` step) rather than reporting
 * success the instant the dispatch fires - see `persistence`/`saveAttemptBaseline`
 * below, the same pattern `PresentModeBrandingSection` uses.
 */
export function LessonImportScreen() {
  const { data, actions, persistence } = useAppData();
  const defaultSchedule = useDefaultSchedule();
  const [state, setState] = useState<WizardState>({ step: "select" });

  // Recomputed whenever the teacher maps an unmatched course name or
  // changes a conflict resolution - mapping one name applies to every row
  // that used it, since this rebuilds the whole preview from the original
  // rows rather than patching one row in place. `defaultSchedule` decides
  // which of a course's sections are "active" (see
  // lib/schedule/activeSections.ts) - the same schedule Week View reads,
  // never modified here.
  const preview = useMemo(() => {
    if (state.step !== "review") return null;
    return buildLessonImportPreview(
      state.rows,
      data.courses,
      data.classSections,
      defaultSchedule,
      data.lessons,
      state.courseMappings,
    );
  }, [state, data.courses, data.classSections, defaultSchedule, data.lessons]);

  // Every course name the file used that Falcon Deck can't auto-match,
  // independent of `state.courseMappings` - so a name's mapping dropdown
  // stays available (and editable) even after it's been mapped, rather
  // than disappearing once the row becomes "ready".
  const namesNeedingMapping = useMemo(() => {
    if (state.step !== "review") return [];
    const seen = new Map<string, string>();
    for (const { row, courseId } of matchImportedCourses(state.rows, data.courses)) {
      if (!courseId && row.course && !seen.has(normalizeCourseNameKey(row.course))) {
        seen.set(normalizeCourseNameKey(row.course), row.course);
      }
    }
    return Array.from(seen.entries());
  }, [state, data.courses]);

  // Resolves once a NEW save (started by this screen's own Import click)
  // has settled - comparing `persistence.attempt` against the baseline
  // captured at click time so this can't mistake an unrelated save (or a
  // stale one from before the click) for confirmation of this import. See
  // PresentModeBrandingSection for the same pattern.
  if (
    state.step === "pending-save" &&
    persistence.attempt > state.saveAttemptBaseline &&
    persistence.status !== "saving"
  ) {
    if (persistence.status === "saved") {
      setState({ step: "results", results: state.results, preview: state.preview });
    } else {
      setState({
        step: "save-error",
        message: `Falcon Deck couldn't save this import.${persistence.error ? ` ${persistence.error}` : ""} Nothing further was changed - try again.`,
      });
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same filename be re-selected later (e.g. after fixing it externally)
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".json")) {
      setState({ step: "parse-error", issues: ["Please choose a .json lesson import file."] });
      return;
    }

    const text = await file.text();
    const parsed = parseLessonImportJson(text);
    if (!parsed.ok) {
      setState({ step: "parse-error", issues: parsed.issues });
      return;
    }

    setState({ step: "review", rows: parsed.rows, resolutions: {}, courseMappings: {}, importAnnouncements: false });
  }

  function setResolution(rowIndex: number, resolution: LessonImportConflictResolution) {
    if (state.step !== "review") return;
    setState({ ...state, resolutions: { ...state.resolutions, [rowIndex]: resolution } });
  }

  function setCourseMapping(unmatchedCourseName: string, courseId: string) {
    if (state.step !== "review") return;
    const key = normalizeCourseNameKey(unmatchedCourseName);
    const nextMappings = { ...state.courseMappings };
    if (courseId) nextMappings[key] = courseId;
    else delete nextMappings[key];
    setState({ ...state, courseMappings: nextMappings });
  }

  function setImportAnnouncements(value: boolean) {
    if (state.step !== "review") return;
    setState({ ...state, importAnnouncements: value });
  }

  function handleImport() {
    if (state.step !== "review" || !preview) return;

    const commit = commitLessonImport({
      preview,
      resolutions: state.resolutions,
      existingLessons: data.lessons,
      generateId,
      now: () => new Date().toISOString(),
      importAnnouncements: state.importAnnouncements,
    });

    const saveAttemptBaseline = persistence.attempt;
    actions.importLessons(commit.lessons);
    setState({ step: "pending-save", results: commit.results, preview, saveAttemptBaseline });
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/settings" className="text-xs font-semibold text-falcon-brown-700/70 hover:underline">
          ← Back to Settings
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-falcon-brown-900">Import Lessons</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Import prepared lesson content (learning target, agenda, materials) into existing courses and
          class sections from a JSON file. This never creates or renames courses/sections, and never
          touches bell schedules, resources, or the calendar.
        </p>
      </div>

      {(state.step === "select" || state.step === "parse-error") && (
        <section className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
          <label className="inline-block cursor-pointer rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-bold text-white hover:bg-falcon-brown-800">
            Choose Lesson Import File (.json)
            <input type="file" accept=".json,application/json" onChange={handleFile} className="hidden" />
          </label>

          {state.step === "parse-error" && (
            <div className="mt-3 rounded-lg border border-red-700/40 bg-red-50 p-3 text-sm text-red-900">
              <p className="mb-2 font-semibold">Falcon Deck couldn&rsquo;t read that file:</p>
              <ul className="list-disc space-y-1 pl-5">
                {state.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {state.step === "review" && preview && (
        <ReviewStep
          preview={preview}
          resolutions={state.resolutions}
          courseMappings={state.courseMappings}
          namesNeedingMapping={namesNeedingMapping}
          courses={data.courses}
          importAnnouncements={state.importAnnouncements}
          onResolutionChange={setResolution}
          onCourseMappingChange={setCourseMapping}
          onImportAnnouncementsChange={setImportAnnouncements}
          onImport={handleImport}
          onStartOver={() => setState({ step: "select" })}
        />
      )}

      {state.step === "pending-save" && (
        <p className="text-sm font-semibold text-falcon-brown-700">Saving import…</p>
      )}

      {state.step === "save-error" && (
        <div className="rounded-lg border border-red-700/40 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">{state.message}</p>
          <button
            type="button"
            onClick={() => setState({ step: "select" })}
            className="mt-3 rounded-md border border-red-700/40 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
          >
            Start over
          </button>
        </div>
      )}

      {state.step === "results" && (
        <ResultsStep
          results={state.results}
          preview={state.preview}
          onImportAnother={() => setState({ step: "select" })}
        />
      )}
    </div>
  );
}

function ReviewStep({
  preview,
  resolutions,
  courseMappings,
  namesNeedingMapping,
  courses,
  importAnnouncements,
  onResolutionChange,
  onCourseMappingChange,
  onImportAnnouncementsChange,
  onImport,
  onStartOver,
}: {
  preview: LessonImportPreview;
  resolutions: Record<number, LessonImportConflictResolution>;
  courseMappings: Record<string, string>;
  namesNeedingMapping: Array<readonly [key: string, displayName: string]>;
  courses: { id: string; name: string }[];
  importAnnouncements: boolean;
  onResolutionChange: (rowIndex: number, resolution: LessonImportConflictResolution) => void;
  onCourseMappingChange: (unmatchedCourseName: string, courseId: string) => void;
  onImportAnnouncementsChange: (value: boolean) => void;
  onImport: () => void;
  onStartOver: () => void;
}) {
  const courseName = (courseId: string | null) => courses.find((c) => c.id === courseId)?.name ?? "";

  const readyRows = preview.rows.filter((r) => r.kind === "ready");
  const totalAnnouncementsInFile = readyRows.reduce((sum, r) => sum + r.announcementPreview.length, 0);

  return (
    <section className="rounded-xl border border-falcon-brown-700/20 bg-white/70 p-4">
      <h2 className="text-lg font-bold text-falcon-brown-900">Review Import</h2>

      <ul className="mt-2 space-y-0.5 text-sm text-falcon-brown-800">
        <li>{preview.totalRows} lesson{preview.totalRows === 1 ? "" : "s"} in file</li>
        <li className="font-semibold text-green-800">
          {preview.readyCount} ready to import{preview.conflictCount > 0 ? ` (${preview.conflictCount} with a conflict)` : ""}
        </li>
        {preview.invalidCount > 0 && (
          <li className="font-semibold text-red-800">{preview.invalidCount} invalid</li>
        )}
        {preview.unmatchedCourseCount > 0 && (
          <li className="font-semibold text-amber-800">{preview.unmatchedCourseCount} unmatched course</li>
        )}
      </ul>

      {totalAnnouncementsInFile > 0 && (
        <div className="mt-3 rounded-md border border-falcon-brown-700/20 bg-white p-3 text-sm">
          <label className="flex items-start gap-2 font-medium text-falcon-brown-900">
            <input
              type="checkbox"
              checked={importAnnouncements}
              onChange={(e) => onImportAnnouncementsChange(e.target.checked)}
              className="mt-0.5"
            />
            Import announcements
          </label>
          <p className="mt-1 text-xs text-falcon-brown-700/70">
            {importAnnouncements
              ? "New announcements will be appended to each section's existing announcements. Exact duplicates are skipped, and existing announcements are never removed or replaced - even for rows set to Replace."
              : `${totalAnnouncementsInFile} announcement${totalAnnouncementsInFile === 1 ? "" : "s"} found in this file will not be imported. Check the box to include them.`}
          </p>
        </div>
      )}

      {namesNeedingMapping.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-2 font-semibold">
            These course names in the file don&rsquo;t match an existing Falcon Deck course. Map each one
            to an existing course to import its lessons, or leave it unmapped to skip them.
          </p>
          <div className="flex flex-col gap-2">
            {namesNeedingMapping.map(([key, displayName]) => (
              <label key={key} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[10rem] font-medium">&ldquo;{displayName}&rdquo;</span>
                <span aria-hidden>→</span>
                <select
                  value={courseMappings[key] ?? ""}
                  onChange={(e) => onCourseMappingChange(displayName, e.target.value)}
                  className="rounded-md border border-amber-600/40 bg-white px-2 py-1 text-sm text-falcon-brown-900"
                >
                  <option value="">— Leave unmapped (skip) —</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {preview.rows.map((rowPreview) => (
          <div
            key={rowPreview.rowIndex}
            className={`rounded-lg border p-3 text-sm ${
              rowPreview.kind === "invalid" || rowPreview.kind === "unmatched-course" || rowPreview.kind === "no-active-sections"
                ? "border-red-700/30 bg-red-50"
                : rowPreview.conflict
                  ? "border-amber-600/40 bg-amber-50"
                  : "border-falcon-brown-700/15 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-falcon-brown-900">
                {rowPreview.row.course || "(no course)"} · {rowPreview.row.date ? formatDateKeyLong(rowPreview.row.date) : "(no date)"}
              </p>
              {rowPreview.kind === "ready" && (
                <span className="text-xs text-falcon-brown-700/60">
                  {sectionCountLabel(rowPreview.sectionIds.length)} · {courseName(rowPreview.courseId)}
                </span>
              )}
            </div>

            {rowPreview.row.learningTarget && (
              <p className="mt-1 text-falcon-brown-800">
                <span className="font-semibold">Learning Target: </span>
                {rowPreview.row.learningTarget}
              </p>
            )}
            {rowPreview.row.what && (
              <p className="mt-1 text-falcon-brown-800">
                <span className="font-semibold">What: </span>
                {rowPreview.row.what}
              </p>
            )}
            {rowPreview.row.how && (
              <p className="mt-1 text-falcon-brown-800">
                <span className="font-semibold">How: </span>
                {rowPreview.row.how}
              </p>
            )}
            {rowPreview.row.why && (
              <p className="mt-1 text-falcon-brown-800">
                <span className="font-semibold">Why: </span>
                {rowPreview.row.why}
              </p>
            )}
            {rowPreview.row.materials && (
              <p className="mt-1 text-falcon-brown-800">
                <span className="font-semibold">Materials: </span>
                {rowPreview.row.materials}
              </p>
            )}

            {rowPreview.kind === "ready" && importAnnouncements && rowPreview.announcementPreview.length > 0 && (
              <div className="mt-2 border-t border-falcon-brown-700/10 pt-2">
                <p className="font-semibold text-falcon-brown-800">Announcements:</p>
                <ul className="mt-1 space-y-0.5">
                  {rowPreview.announcementPreview.map((entry, i) => (
                    <li key={i} className="text-falcon-brown-800">
                      {entry.sectionIdsToAdd.length > 0 ? (
                        <span className="text-green-800">
                          + will be added{entry.sectionIdsAlreadyPresent.length > 0 ? ` (to ${entry.sectionIdsToAdd.length} of ${entry.sectionIdsToAdd.length + entry.sectionIdsAlreadyPresent.length} sections)` : ""}:{" "}
                        </span>
                      ) : (
                        <span className="text-falcon-brown-700/60">already present, will be skipped: </span>
                      )}
                      {entry.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rowPreview.kind === "invalid" && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-red-900">
                {rowPreview.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            {(rowPreview.kind === "unmatched-course" || rowPreview.kind === "no-active-sections") && (
              <p className="mt-2 text-red-900">{unmatchedReason(rowPreview)}</p>
            )}

            {rowPreview.kind === "ready" && rowPreview.conflict && (
              <div className="mt-2 flex flex-wrap gap-3 border-t border-amber-600/30 pt-2">
                {(["skip", "replace", "merge"] as const).map((option) => (
                  <label key={option} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="radio"
                      name={`resolution-${rowPreview.rowIndex}`}
                      checked={(resolutions[rowPreview.rowIndex] ?? "skip") === option}
                      onChange={() => onResolutionChange(rowPreview.rowIndex, option)}
                    />
                    {RESOLUTION_LABELS[option]}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onImport}
          disabled={preview.readyCount === 0}
          className="rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-bold text-white hover:bg-falcon-brown-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Import {preview.readyCount} Lesson{preview.readyCount === 1 ? "" : "s"}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="rounded-md border border-falcon-brown-700/30 px-4 py-2 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/30"
        >
          Choose a Different File
        </button>
      </div>
    </section>
  );
}

function ResultsStep({
  results,
  preview,
  onImportAnother,
}: {
  results: LessonImportRowResult[];
  preview: LessonImportPreview;
  onImportAnother: () => void;
}) {
  const countByOutcome = (outcome: LessonImportRowOutcome) =>
    results.filter((r) => r.outcome === outcome).length;
  const totalAnnouncementsAdded = results.reduce((sum, r) => sum + r.announcementsAdded, 0);

  const notImported = preview.rows.filter(
    (r) => r.kind === "invalid" || r.kind === "unmatched-course" || r.kind === "no-active-sections",
  );

  return (
    <section className="rounded-xl border border-falcon-brown-700/20 bg-white/70 p-4">
      <h2 className="text-lg font-bold text-falcon-brown-900">Import Complete</h2>
      <ul className="mt-2 space-y-0.5 text-sm text-falcon-brown-800">
        <li>{countByOutcome("imported")} lesson{countByOutcome("imported") === 1 ? "" : "s"} imported</li>
        <li>{countByOutcome("replaced")} lesson{countByOutcome("replaced") === 1 ? "" : "s"} replaced</li>
        <li>{countByOutcome("merged")} lesson{countByOutcome("merged") === 1 ? "" : "s"} merged</li>
        <li>{countByOutcome("skipped")} lesson{countByOutcome("skipped") === 1 ? "" : "s"} skipped</li>
        {totalAnnouncementsAdded > 0 && (
          <li>{totalAnnouncementsAdded} announcement{totalAnnouncementsAdded === 1 ? "" : "s"} added</li>
        )}
        <li className={notImported.length > 0 ? "font-semibold text-red-800" : "font-semibold text-green-800"}>
          {notImported.length} error{notImported.length === 1 ? "" : "s"}
        </li>
      </ul>

      {notImported.length > 0 && (
        <div className="mt-3 rounded-md border border-red-700/40 bg-red-50 p-3 text-sm text-red-900">
          <p className="mb-1 font-semibold">Not imported:</p>
          <ul className="list-disc space-y-1 pl-5">
            {notImported.map((row) => (
              <li key={row.rowIndex}>
                {row.row.course || "(no course)"} · {row.row.date || "(no date)"} —{" "}
                {row.kind === "invalid" ? row.issues.join(" ") : unmatchedReason(row)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onImportAnother}
        className="mt-4 rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-bold text-white hover:bg-falcon-brown-800"
      >
        Import Another File
      </button>
    </section>
  );
}
