"use client";

import { useState } from "react";
import Link from "next/link";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { getLocalDateKey } from "@/lib/schedule/localDate";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";

export function ClassesScreen() {
  const { data, actions } = useAppData();
  const defaultSchedule = useDefaultSchedule();
  const todayKey = getLocalDateKey(new Date(), defaultSchedule?.timeZone ?? DEFAULT_TIME_ZONE);
  const [newCourseName, setNewCourseName] = useState("");
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionCourseId, setNewSectionCourseId] = useState("");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Classes</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Placeholder demo courses and sections — not the official OHHS course catalog. Sections
          are what schedule blocks reference in Schedule Setup.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
            Courses
          </h2>
          <ul className="space-y-2">
            {data.courses.map((course) => (
              <li
                key={course.id}
                className="flex items-center gap-2 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3"
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: course.colorHex ?? "#7A7267" }}
                />
                <span className="font-semibold text-falcon-brown-900">{course.name}</span>
              </li>
            ))}
          </ul>

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
            <button
              type="submit"
              className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100"
            >
              Add Course
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
            Class Sections
          </h2>
          <ul className="space-y-2">
            {data.classSections.map((section) => {
              const course = data.courses.find((c) => c.id === section.courseId);
              return (
                <li
                  key={section.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3"
                >
                  <div>
                    <p className="font-semibold text-falcon-brown-900">{section.name}</p>
                    <p className="text-xs text-falcon-brown-700/60">{course?.name ?? "Unknown course"}</p>
                  </div>
                  <Link
                    href={`/lessons?date=${todayKey}&section=${section.id}`}
                    className="shrink-0 rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-xs font-semibold text-falcon-brown-800 hover:bg-falcon-gold-300/40"
                  >
                    Today&rsquo;s Lesson
                  </Link>
                </li>
              );
            })}
          </ul>

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
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
            <input
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="New section name"
              className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
            <button
              type="submit"
              className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100"
            >
              Add Section
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
