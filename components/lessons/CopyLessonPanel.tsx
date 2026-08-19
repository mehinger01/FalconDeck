"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { getCopyDestinationSections } from "@/lib/data/lessons";
import { addDaysToDateKey } from "@/lib/schedule/localDate";
import type { DailyLesson } from "@/types/lesson";

/**
 * Copies never silently overwrite: each copy is first attempted without
 * `overwrite`, and only re-attempted with `overwrite: true` after the
 * teacher explicitly confirms replacing what's already at the destination.
 */
function confirmAndCopy(run: (overwrite: boolean) => "copied" | "conflict", destinationLabel: string) {
  const result = run(false);
  if (result === "conflict" && window.confirm(`A lesson already exists for ${destinationLabel}. Replace it?`)) {
    run(true);
  }
}

export function CopyLessonPanel({ lesson }: { lesson: DailyLesson }) {
  const { data, actions } = useAppData();
  const destinationSections = getCopyDestinationSections(data.classSections, lesson.classSectionId);
  const [targetSectionId, setTargetSectionId] = useState(destinationSections[0]?.id ?? "");
  const [targetDate, setTargetDate] = useState(lesson.date);

  const tomorrow = addDaysToDateKey(lesson.date, 1);

  return (
    <section className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
        Copy This Lesson
      </h2>

      <button
        type="button"
        onClick={() =>
          confirmAndCopy(
            (overwrite) =>
              overwrite
                ? actions.copyLessonToSection(lesson.id, lesson.classSectionId, tomorrow, { overwrite: true })
                : actions.copyLessonToTomorrow(lesson.id),
            `tomorrow (${tomorrow})`,
          )
        }
        className="mb-4 w-full rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
      >
        Copy → Tomorrow
      </button>

      {destinationSections.length === 0 ? (
        <p className="text-sm text-falcon-brown-700/60">
          No other sections share this lesson&rsquo;s course, so there&rsquo;s nowhere else to copy it.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Destination Period</span>
            <select
              value={targetSectionId}
              onChange={(e) => setTargetSectionId(e.target.value)}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm"
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
              onChange={(e) => setTargetDate(e.target.value)}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!targetSectionId) return;
              const destinationName =
                destinationSections.find((s) => s.id === targetSectionId)?.name ?? "that period";
              confirmAndCopy(
                (overwrite) =>
                  actions.copyLessonToSection(lesson.id, targetSectionId, targetDate, { overwrite }),
                `${destinationName} on ${targetDate}`,
              );
            }}
            className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
          >
            Copy → Period
          </button>
        </div>
      )}
    </section>
  );
}
