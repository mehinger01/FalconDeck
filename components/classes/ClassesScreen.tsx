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

  const scheduledSectionIds = useMemo(() => {
    if (!defaultSchedule) return new Set<string>();
    return new Set(
      defaultSchedule.blocks
        .filter((block) => block.kind !== "passing" && block.classSectionId)
        .map((block) => block.classSectionId as string),
    );
  }, [defaultSchedule]);

  const scheduledSections = data.classSections.filter((section) => scheduledSectionIds.has(section.id));
  const unscheduledSections = data.classSections.filter((section) => !scheduledSectionIds.has(section.id));
  const scheduledCourseIds = new Set(scheduledSections.map((section) => section.courseId));
  const currentCourses = data.courses.filter((course) => scheduledCourseIds.has(course.id));
  const otherCourses = data.courses.filter((course) => !scheduledCourseIds.has(course.id));

  function renderSection(section: (typeof data.classSections)[number], showScheduleStatus = false) {
    const course = data.courses.find((c) => c.id === section.courseId);
    const hasArrivalRoutine =
      (findClassPresentationSettings(data.classPresentationSettings, section.id)?.arrivalInstructions.length ?? 0) > 0;
    const routineExpanded = expandedRoutineSectionId === section.id;

    return (
      <li key={section.id} className="rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-falcon-brown-900">{section.name}</p>
              {showScheduleStatus && (
                <span className="rounded-full border border-amber-700/20 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                  Not on current schedule
                </span>
              )}
            </div>
            <p className="text-xs text-falcon-brown-700/60">{course?.name ?? "Unknown course"}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {showScheduleStatus && (
              <Link
                href="/schedule"
                className="rounded-md border border-amber-700/30 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Assign Schedule
              </Link>
            )}
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
          Classes are never archived automatically. Schedule Setup only determines when each section runs.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Courses</h2>
          {data.courses.length === 0 ? (
            <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-4 text-sm text-falcon-brown-700/60">
              No courses yet. Add one below to start building your class list.
            </p>
          ) : (
            <>
              {currentCourses.length > 0 && (
                <ul className="space-y-2">
                  {currentCourses.map((course) => (
                    <li key={course.id} className="flex items-center gap-2 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: course.colorHex ?? "#7A7267" }} />
                      <span className="font-semibold text-falcon-brown-900">{course.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {otherCourses.length > 0 && (
                <details className="mt-3 rounded-lg border border-falcon-brown-700/15 bg-white/35 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-falcon-brown-700">
                    Other courses ({otherCourses.length})
                  </summary>
                  <ul className="mt-3 space-y-2">
                    {otherCourses.map((course) => (
                      <li key={course.id} className="flex items-center gap-2 rounded-md border border-falcon-brown-700/10 bg-white/50 p-2 text-sm text-falcon-brown-700/75">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: course.colorHex ?? "#7A7267" }} />
                        {course.name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
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
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Class Sections</h2>

          {scheduledSections.length > 0 && (
            <ul className="space-y-2">{scheduledSections.map((section) => renderSection(section))}</ul>
          )}

          {unscheduledSections.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-700/15 bg-amber-50/40 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-falcon-brown-900">Needs schedule assignment</p>
                  <p className="text-xs text-falcon-brown-700/65">
                    These sections still exist normally; they are simply not referenced by your current default schedule.
                  </p>
                </div>
                <Link
                  href="/schedule"
                  className="rounded-md border border-falcon-brown-700/30 bg-white px-3 py-1.5 text-xs font-semibold text-falcon-brown-800 hover:bg-falcon-gold-300/30"
                >
                  Open Schedule Setup
                </Link>
              </div>
              <ul className="space-y-2">{unscheduledSections.map((section) => renderSection(section, true))}</ul>
            </div>
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
