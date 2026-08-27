"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { getLocalDateKey } from "@/lib/schedule/localDate";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import { findClassPresentationSettings } from "@/lib/data/classPresentation";
import { ArrivalRoutineEditor } from "./ArrivalRoutineEditor";

export function ClassesScreen() {
  const { data, actions } = useAppData();
  const defaultSchedule = useDefaultSchedule();
  const todayKey = getLocalDateKey(new Date(), defaultSchedule?.timeZone ?? DEFAULT_TIME_ZONE);
  const [newCourseName, setNewCourseName] = useState("");
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionCourseId, setNewSectionCourseId] = useState("");
  const [expandedRoutineSectionId, setExpandedRoutineSectionId] = useState<string | null>(null);

  const activeSectionIds = useMemo(() => {
    if (!defaultSchedule) return new Set<string>();
    return new Set(
      defaultSchedule.blocks
        .filter((block) => block.kind !== "passing" && block.classSectionId)
        .map((block) => block.classSectionId as string),
    );
  }, [defaultSchedule]);

  const activeSections = data.classSections.filter((section) => activeSectionIds.has(section.id));
  const inactiveSections = data.classSections.filter((section) => !activeSectionIds.has(section.id));
  const activeCourseIds = new Set(activeSections.map((section) => section.courseId));
  const activeCourses = data.courses.filter((course) => activeCourseIds.has(course.id));
  const inactiveCourses = data.courses.filter((course) => !activeCourseIds.has(course.id));

  function renderSection(section: (typeof data.classSections)[number]) {
    const course = data.courses.find((c) => c.id === section.courseId);
    const hasArrivalRoutine =
      (findClassPresentationSettings(data.classPresentationSettings, section.id)?.arrivalInstructions.length ?? 0) > 0;
    const routineExpanded = expandedRoutineSectionId === section.id;

    return (
      <li key={section.id} className="rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-falcon-brown-900">{section.name}</p>
            <p className="text-xs text-falcon-brown-700/60">{course?.name ?? "Unknown course"}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setExpandedRoutineSectionId(routineExpanded ? null : section.id)}
              aria-expanded={routineExpanded}
              className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-xs font-semibold text-falcon-brown-800 hover:bg-falcon-gold-300/40"
            >
              {hasArrivalRoutine ? "Arrival Routine ✓" : "Arrival Routine"}
            </button>
            <Link
              href={`/lessons?date=${todayKey}&section=${section.id}`}
              className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-xs font-semibold text-falcon-brown-800 hover:bg-falcon-gold-300/40"
            >
              Today&rsquo;s Lesson
            </Link>
          </div>
        </div>
        {routineExpanded && <ArrivalRoutineEditor classSectionId={section.id} />}
      </li>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Classes</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Your active classes come from the sections assigned to your default schedule. Old or unused setup stays out of the way below.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Current Courses</h2>
          {activeCourses.length === 0 ? (
            <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-4 text-sm text-falcon-brown-700/60">
              No active courses yet. Assign class sections to your default schedule in Schedule Setup.
            </p>
          ) : (
            <ul className="space-y-2">
              {activeCourses.map((course) => (
                <li key={course.id} className="flex items-center gap-2 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: course.colorHex ?? "#7A7267" }} />
                  <span className="font-semibold text-falcon-brown-900">{course.name}</span>
                </li>
              ))}
            </ul>
          )}

          {inactiveCourses.length > 0 && (
            <details className="mt-3 rounded-lg border border-falcon-brown-700/15 bg-white/35 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-falcon-brown-700">
                Inactive / old courses ({inactiveCourses.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {inactiveCourses.map((course) => (
                  <li key={course.id} className="flex items-center gap-2 rounded-md border border-falcon-brown-700/10 bg-white/50 p-2 text-sm text-falcon-brown-700/75">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: course.colorHex ?? "#7A7267" }} />
                    {course.name}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = newCourseName.trim();
              if (!name) return;
              actions.addCourse({ name });
              setNewCourseName("");
            }}
            className="mt-3 flex gap-2"
          >
            <input
              value={newCourseName}
              onChange={(e) => setNewCourseName(e.target.value)}
              placeholder="New course name"
              className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
            <button type="submit" className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100">
              Add Course
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Current Class Sections</h2>
          {activeSections.length === 0 ? (
            <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-4 text-sm text-falcon-brown-700/60">
              No active sections yet. Map sections to your default schedule in Schedule Setup.
            </p>
          ) : (
            <ul className="space-y-2">{activeSections.map(renderSection)}</ul>
          )}

          {inactiveSections.length > 0 && (
            <details className="mt-3 rounded-lg border border-falcon-brown-700/15 bg-white/35 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-falcon-brown-700">
                Inactive / old sections ({inactiveSections.length})
              </summary>
              <ul className="mt-3 space-y-2">{inactiveSections.map(renderSection)}</ul>
            </details>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = newSectionName.trim();
              if (!name || !newSectionCourseId) return;
              actions.addClassSection({ name, courseId: newSectionCourseId });
              setNewSectionName("");
            }}
            className="mt-3 flex flex-wrap gap-2"
          >
            <select
              value={newSectionCourseId}
              onChange={(e) => setNewSectionCourseId(e.target.value)}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            >
              <option value="">Choose a course…</option>
              {data.courses.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
            <input
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="New section name"
              className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
            <button type="submit" className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100">
              Add Section
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
