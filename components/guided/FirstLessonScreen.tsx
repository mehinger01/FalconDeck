"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  addAgendaItem,
  addAnnouncement,
  addResource,
  describeLessonDate,
  removeAgendaItem,
  removeAnnouncement,
  removeResource,
  sampleLearningTarget,
  todayInSchoolTime,
  updateAgendaItem,
  updateAnnouncement,
  updateLesson,
} from "@/lib/onboarding/firstLesson";
import { formatDateKeyLong } from "@/lib/schedule/localDate";
import type { SchoolYearCalendar } from "@/types/calendar";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";
import { DraftTextInput } from "./DraftTextInput";

const FIELD =
  "rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-sm text-falcon-brown-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 disabled:opacity-60";
const LABEL = "flex flex-col gap-1 text-sm font-medium text-falcon-brown-800";
const BUTTON_PRIMARY =
  "rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";
const BUTTON_SECONDARY =
  "rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";

export interface FirstLessonScreenProps {
  draft: SetupDraft;
  schoolSchedules: BellSchedule[];
  schoolCalendar: SchoolYearCalendar | null;
  disabled: boolean;
  onEdit: (change: (draft: SetupDraft) => SetupDraft) => void;
  onPendingChange: (key: string, pending: boolean) => void;
}

export function FirstLessonScreen({ draft, schoolSchedules, schoolCalendar, disabled, onEdit, onPendingChange }: FirstLessonScreenProps) {
  const lesson = draft.firstLesson;
  const targetField = useRef<HTMLInputElement>(null);
  // "Today" follows the clock: a page left open overnight must not keep offering yesterday.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const today = todayInSchoolTime(draft, schoolSchedules, now);
  const dateNote = lesson?.date ? describeLessonDate(draft, { schoolSchedules, schoolCalendar }, lesson.date) : null;
  const classId = useId();
  const dateId = useId();
  const targetId = useId();

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-8 disabled:opacity-70">
      <section aria-labelledby="lesson-class-heading" className="flex flex-col gap-2">
        <h2 id="lesson-class-heading" className="text-lg font-semibold text-falcon-brown-900">
          Which class is it for?
        </h2>
        {draft.classSections.length === 0 ? (
          <p className="text-sm text-falcon-brown-700/80">Add a class on the previous step first.</p>
        ) : (
          <>
            <label htmlFor={classId} className="sr-only">
              Class
            </label>
            <select
              id={classId}
              className={FIELD}
              value={lesson?.classSectionId ?? ""}
              onChange={(e) => onEdit((d) => updateLesson(d, { classSectionId: e.target.value }))}
            >
              <option value="">Choose a class</option>
              {draft.classSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </>
        )}
      </section>

      <section aria-labelledby="lesson-date-heading" className="flex flex-col gap-2">
        <h2 id="lesson-date-heading" className="text-lg font-semibold text-falcon-brown-900">
          When will you teach it?
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={dateId} className="sr-only">
            Lesson date
          </label>
          <input
            id={dateId}
            type="date"
            className={FIELD}
            value={lesson?.date ?? ""}
            onChange={(e) => onEdit((d) => updateLesson(d, { date: e.target.value }))}
          />
          {today && lesson?.date !== today && (
            <button
              type="button"
              className={BUTTON_SECONDARY}
              onClick={() =>
                onEdit((d) => {
                  // Read the date at the moment of the click, not when the label last rendered.
                  const current = todayInSchoolTime(d, schoolSchedules, new Date());
                  return current ? updateLesson(d, { date: current }) : d;
                })
              }
            >
              Today ({formatDateKeyLong(today)})
            </button>
          )}
        </div>
        {dateNote && (
          <p role="status" className={`text-sm ${dateNote.tone === "warn" ? "rounded-md bg-falcon-gold-300/20 px-3 py-2 text-falcon-brown-900" : "text-falcon-brown-700/80"}`}>
            {dateNote.message}
          </p>
        )}
      </section>

      <section aria-labelledby="lesson-target-heading" className="flex flex-col gap-2">
        <h2 id="lesson-target-heading" className="text-lg font-semibold text-falcon-brown-900">
          Learning target
        </h2>
        <p className="text-sm text-falcon-brown-700/70">What should students be able to do by the end of the lesson?</p>
        <label htmlFor={targetId} className="sr-only">
          Learning target
        </label>
        <DraftTextInput
          id={targetId}
          ref={targetField}
          className={FIELD}
          placeholder="I can…"
          value={lesson?.learningTarget ?? ""}
          onCommit={(value) => onEdit((d) => updateLesson(d, { learningTarget: value }))}
          onPendingChange={(pending) => onPendingChange("lesson-target", pending)}
        />
        {(lesson?.learningTarget ?? "").trim() === "" && (
          <div>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              onClick={() => {
                onEdit((d) => updateLesson(d, { learningTarget: sampleLearningTarget(d) }));
                requestAnimationFrame(() => targetField.current?.focus());
              }}
            >
              Use a sample learning target
            </button>
            <p className="mt-1 text-xs text-falcon-brown-700/70">Puts an example in the box above for you to change.</p>
          </div>
        )}
      </section>

      <details className="rounded-md border border-falcon-brown-700/20 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-falcon-brown-900">Add more (optional): agenda, resources, announcements</summary>
        <div className="mt-4 flex flex-col gap-6">
          <AgendaEditor draft={draft} onEdit={onEdit} onPendingChange={onPendingChange} />
          <ResourceEditor draft={draft} onEdit={onEdit} />
          <AnnouncementEditor draft={draft} onEdit={onEdit} onPendingChange={onPendingChange} />
        </div>
      </details>
    </fieldset>
  );
}

function AddRow({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const id = useId();
  const add = () => {
    if (text.trim() === "") return;
    onAdd(text);
    setText("");
  };
  return (
    <div className="flex flex-wrap gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        className={`${FIELD} flex-1`}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      <button type="button" className={BUTTON_SECONDARY} onClick={add} disabled={text.trim() === ""}>
        {label}
      </button>
    </div>
  );
}

function AgendaEditor({ draft, onEdit, onPendingChange }: Pick<FirstLessonScreenProps, "draft" | "onEdit" | "onPendingChange">) {
  const items = draft.firstLesson?.agendaItems ?? [];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-falcon-brown-900">Agenda</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={item.id} className="flex gap-2">
            <label className="sr-only" htmlFor={`agenda-${item.id}`}>
              Agenda item {index + 1}
            </label>
            <DraftTextInput
              id={`agenda-${item.id}`}
              className={`${FIELD} flex-1`}
              value={item.title}
              onCommit={(value) => onEdit((d) => updateAgendaItem(d, item.id, value))}
              onPendingChange={(pending) => onPendingChange(`agenda-${item.id}`, pending)}
            />
            <button type="button" className={BUTTON_SECONDARY} aria-label={`Remove agenda item ${index + 1}`} onClick={() => onEdit((d) => removeAgendaItem(d, item.id))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <AddRow label="Add agenda item" placeholder="e.g. Warm-up problem" onAdd={(text) => onEdit((d) => addAgendaItem(d, text))} />
    </div>
  );
}

function ResourceEditor({ draft, onEdit }: Pick<FirstLessonScreenProps, "draft" | "onEdit">) {
  const resources = draft.firstLesson?.resources ?? [];
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const titleId = useId();
  const urlId = useId();
  const add = () => {
    if (title.trim() === "" || url.trim() === "") return;
    onEdit((d) => addResource(d, { title, url }));
    setTitle("");
    setUrl("");
  };
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-falcon-brown-900">Resources</h3>
      <ul className="flex flex-col gap-2">
        {resources.map((resource) => (
          <li key={resource.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-falcon-brown-700/15 px-3 py-2 text-sm">
            <span>
              <span className="font-semibold">{resource.title}</span> <span className="break-all text-falcon-brown-700/70">{resource.url}</span>
            </span>
            <button type="button" className={BUTTON_SECONDARY} aria-label={`Remove resource ${resource.title}`} onClick={() => onEdit((d) => removeResource(d, resource.id))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
        <label htmlFor={titleId} className={LABEL}>
          <span className="text-xs">Title</span>
          <input id={titleId} className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Notes slides" />
        </label>
        <label htmlFor={urlId} className={LABEL}>
          <span className="text-xs">Link</span>
          <input id={urlId} className={FIELD} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </label>
        <button type="button" className={`${BUTTON_PRIMARY} self-end`} onClick={add} disabled={title.trim() === "" || url.trim() === ""}>
          Add resource
        </button>
      </div>
    </div>
  );
}

function AnnouncementEditor({ draft, onEdit, onPendingChange }: Pick<FirstLessonScreenProps, "draft" | "onEdit" | "onPendingChange">) {
  const announcements = draft.firstLesson?.announcements ?? [];
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-falcon-brown-900">Announcements</h3>
      <ul className="flex flex-col gap-2">
        {announcements.map((announcement, index) => (
          <li key={announcement.id} className="flex gap-2">
            <label className="sr-only" htmlFor={`announcement-${announcement.id}`}>
              Announcement {index + 1}
            </label>
            <DraftTextInput
              id={`announcement-${announcement.id}`}
              className={`${FIELD} flex-1`}
              value={announcement.text}
              onCommit={(value) => onEdit((d) => updateAnnouncement(d, announcement.id, value))}
              onPendingChange={(pending) => onPendingChange(`announcement-${announcement.id}`, pending)}
            />
            <button type="button" className={BUTTON_SECONDARY} aria-label={`Remove announcement ${index + 1}`} onClick={() => onEdit((d) => removeAnnouncement(d, announcement.id))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <AddRow label="Add announcement" placeholder="e.g. Quiz on Friday" onAdd={(text) => onEdit((d) => addAnnouncement(d, text))} />
    </div>
  );
}
