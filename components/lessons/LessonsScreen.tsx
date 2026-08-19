"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { findLessonForSection } from "@/lib/data/lessons";
import { resolveCourseForSection } from "@/lib/data/resolve";
import { addDaysToDateKey, formatDateKeyLong, getLocalDateKey } from "@/lib/schedule/localDate";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import { ClassSectionSelect } from "@/components/schedule/ClassSectionSelect";
import { CopyLessonPanel } from "./CopyLessonPanel";
import { LessonAgendaEditor } from "./LessonAgendaEditor";
import { LessonAnnouncementEditor } from "./LessonAnnouncementEditor";
import { LessonResourceEditor } from "./LessonResourceEditor";

export function LessonsScreen() {
  const { data, actions } = useAppData();
  const defaultSchedule = useDefaultSchedule();
  const timeZone = defaultSchedule?.timeZone ?? DEFAULT_TIME_ZONE;
  const searchParams = useSearchParams();

  const [date, setDate] = useState(() => searchParams.get("date") ?? getLocalDateKey(new Date(), timeZone));
  const [classSectionId, setClassSectionId] = useState<string | null>(
    () => searchParams.get("section") ?? data.classSections[0]?.id ?? null,
  );

  // Re-sync from the URL for navigation into an already-mounted Lessons
  // screen, e.g. the Classes page's "Today's Lesson" link. Adjusting state
  // during render (React's documented pattern for this) rather than in an
  // effect, since the URL is the source of truth whenever it changes.
  const searchParamsKey = searchParams.toString();
  const [syncedParamsKey, setSyncedParamsKey] = useState(searchParamsKey);
  if (searchParamsKey !== syncedParamsKey) {
    setSyncedParamsKey(searchParamsKey);
    const paramDate = searchParams.get("date");
    const paramSection = searchParams.get("section");
    if (paramDate) setDate(paramDate);
    if (paramSection) setClassSectionId(paramSection);
  }

  const section = data.classSections.find((s) => s.id === classSectionId) ?? null;
  const course = resolveCourseForSection(data.courses, section);
  const lesson = classSectionId ? findLessonForSection(data.lessons, date, classSectionId) : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Lessons</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Plan a lesson for a date and class section. Present Mode automatically shows whichever
          lesson matches the class section currently in front of students - there&rsquo;s no manual
          lesson picker there.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          />
        </label>

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setDate((d) => addDaysToDateKey(d, -1))}
            className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-medium text-falcon-brown-900 hover:bg-falcon-gold-300/30"
          >
            ← Previous Day
          </button>
          <button
            type="button"
            onClick={() => setDate(getLocalDateKey(new Date(), timeZone))}
            className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-medium text-falcon-brown-900 hover:bg-falcon-gold-300/30"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDate((d) => addDaysToDateKey(d, 1))}
            className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-medium text-falcon-brown-900 hover:bg-falcon-gold-300/30"
          >
            Next Day →
          </button>
        </div>

        <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Class Section</span>
          <ClassSectionSelect value={classSectionId} onChange={setClassSectionId} />
        </label>
      </div>

      {!classSectionId ? (
        <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-6 text-center text-sm text-falcon-brown-700/60">
          Choose a class section to plan a lesson.
        </p>
      ) : (
        <>
          <div className="mb-4">
            <p className="text-sm font-semibold text-falcon-brown-900">{formatDateKeyLong(date)}</p>
            <p className="text-xs text-falcon-brown-700/60">
              {section?.name ?? "Unknown section"}
              {course ? ` · ${course.name}` : ""}
            </p>
          </div>

          <section className="mb-6 rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
              Learning Target
            </h2>
            <textarea
              value={lesson?.learningTarget ?? ""}
              onChange={(e) => actions.updateLearningTarget(date, classSectionId, e.target.value)}
              placeholder="What should students be able to do by the end of class?"
              rows={2}
              className="w-full rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-sm text-falcon-brown-900"
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <LessonAgendaEditor
              key={`agenda:${date}:${classSectionId}`}
              date={date}
              classSectionId={classSectionId}
              agendaItems={lesson?.agendaItems ?? []}
            />
            <LessonResourceEditor
              key={`resources:${date}:${classSectionId}`}
              date={date}
              classSectionId={classSectionId}
              resources={lesson?.resources ?? []}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <LessonAnnouncementEditor
              key={`announcements:${date}:${classSectionId}`}
              date={date}
              classSectionId={classSectionId}
              announcements={lesson?.announcements ?? []}
            />
            {lesson ? (
              <CopyLessonPanel key={lesson.id} lesson={lesson} />
            ) : (
              <section className="rounded-xl border border-dashed border-falcon-brown-700/30 p-4">
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
                  Copy This Lesson
                </h2>
                <p className="text-sm text-falcon-brown-700/60">
                  Add a learning target, agenda item, resource, or announcement first - there&rsquo;s
                  nothing to copy yet.
                </p>
              </section>
            )}
          </div>

          {lesson && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Delete this lesson? This cannot be undone.")) {
                    actions.deleteLesson(lesson.id);
                  }
                }}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-800/10"
              >
                Delete This Lesson
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
