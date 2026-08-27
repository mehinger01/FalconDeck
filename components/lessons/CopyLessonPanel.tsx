"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { addDaysToDateKey } from "@/lib/schedule/localDate";
import type { DailyLesson } from "@/types/lesson";

/**
 * Copies never silently overwrite: each copy is first attempted without
 * `overwrite`, and only re-attempted with `overwrite: true` after the
 * teacher explicitly confirms replacing what's already at the destination.
 */
function confirmAndCopy(
  run: (overwrite: boolean) => "copied" | "conflict",
  destinationLabel: string,
): "copied" | "cancelled" {
  const result = run(false);
  if (result === "copied") return "copied";
  if (window.confirm(`A lesson already exists for ${destinationLabel}. Replace it?`)) {
    return run(true) === "copied" ? "copied" : "cancelled";
  }
  return "cancelled";
}

export function CopyLessonPanel({ lesson }: { lesson: DailyLesson }) {
  const { data } = useAppData();
  const { actions } = useAppData();
  const schedule = data.schedules.find((s) => s.isDefault) ?? data.schedules[0] ?? null;

  const destinationSections = useMemo(() => {
    const source = data.classSections.find((section) => section.id === lesson.classSectionId);
    if (!source || !schedule) return [];

    const sourceCourse = data.courses.find((course) => course.id === source.courseId);
    const sourceCourseName = sourceCourse?.name.trim().toLowerCase() ?? "";

    const startTimes = new Map<string, string>();
    for (const block of schedule.blocks) {
      if (
        (block.kind !== "instructional" && block.kind !== "enrichment") ||
        !block.classSectionId
      ) {
        continue;
      }
      const existing = startTimes.get(block.classSectionId);
      if (!existing || block.startTime < existing) startTimes.set(block.classSectionId, block.startTime);
    }

    return data.classSections
      .filter((section) => {
        if (section.id === lesson.classSectionId || !startTimes.has(section.id)) return false;
        if (section.courseId === source.courseId) return true;

        // Early Falcon Deck demo data could leave duplicate Course records
        // with the same visible name. During cleanup, treat those duplicate
        // names as the same course so a real scheduled Algebra section does
        // not disappear merely because it points at the newer Algebra record.
        const course = data.courses.find((candidate) => candidate.id === section.courseId);
        return Boolean(sourceCourseName && course?.name.trim().toLowerCase() === sourceCourseName);
      })
      .sort((a, b) => {
        const byTime = (startTimes.get(a.id) ?? "99:99").localeCompare(startTimes.get(b.id) ?? "99:99");
        return byTime !== 0 ? byTime : a.name.localeCompare(b.name);
      });
  }, [data.classSections, data.courses, lesson.classSectionId, schedule]);

  const [targetSectionId, setTargetSectionId] = useState("");
  const [targetDate, setTargetDate] = useState(lesson.date);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  // The root provider initially renders demo seed data and hydrates saved
  // teacher data after mount. Never let the destination state retain a seed
  // section id that is no longer present in the hydrated eligible list.
  useEffect(() => {
    if (destinationSections.some((section) => section.id === targetSectionId)) return;
    setTargetSectionId(destinationSections[0]?.id ?? "");
  }, [destinationSections, targetSectionId]);

  useEffect(() => {
    setTargetDate(lesson.date);
    setCopyMessage(null);
  }, [lesson.id, lesson.date]);

  const tomorrow = addDaysToDateKey(lesson.date, 1);

  return (
    <section className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
        Copy This Lesson
      </h2>

      <button
        type="button"
        onClick={() => {
          const result = confirmAndCopy(
            (overwrite) =>
              overwrite
                ? actions.copyLessonToSection(lesson.id, lesson.classSectionId, tomorrow, { overwrite: true })
                : actions.copyLessonToTomorrow(lesson.id),
            `tomorrow (${tomorrow})`,
          );
          if (result === "copied") setCopyMessage(`Copied to tomorrow (${tomorrow}).`);
        }}
        className="mb-4 w-full rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
      >
        Copy → Tomorrow
      </button>

      {destinationSections.length === 0 ? (
        <p className="text-sm text-falcon-brown-700/60">
          No other scheduled sections of this course are available as copy destinations.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Destination Period</span>
            <select
              value={targetSectionId}
              onChange={(e) => {
                setTargetSectionId(e.target.value);
                setCopyMessage(null);
              }}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            >
              {destinationSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Date</span>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
                setCopyMessage(null);
              }}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!targetSectionId) return;
              const destinationName =
                destinationSections.find((s) => s.id === targetSectionId)?.name ?? "that period";
              const result = confirmAndCopy(
                (overwrite) =>
                  actions.copyLessonToSection(lesson.id, targetSectionId, targetDate, { overwrite }),
                `${destinationName} on ${targetDate}`,
              );
              if (result === "copied") {
                setCopyMessage(`Copied to ${destinationName} on ${targetDate}.`);
              }
            }}
            className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
          >
            Copy → Period
          </button>
        </div>
      )}

      {copyMessage && (
        <p className="mt-3 text-sm font-semibold text-falcon-brown-800" role="status">
          ✓ {copyMessage}
        </p>
      )}
    </section>
  );
}
