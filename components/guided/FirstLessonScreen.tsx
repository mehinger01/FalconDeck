"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  describeLessonDate,
  removeAgendaItem,
  removeAnnouncement,
  removeResource,
  sampleLearningTarget,
  startAgendaItem,
  startAnnouncement,
  startResource,
  todayInSchoolTime,
  updateAgendaItem,
  updateAnnouncement,
  updateLesson,
  updateResource,
} from "@/lib/onboarding/firstLesson";
import { formatDateKeyLong } from "@/lib/schedule/localDate";
import type { SchoolYearCalendar } from "@/types/calendar";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";
import { DraftTextInput } from "./DraftTextInput";

const FIELD =
  "rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-sm text-falcon-brown-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 disabled:opacity-60";
const LABEL = "flex flex-col gap-1 text-sm font-medium text-falcon-brown-800";
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
  const hasOptionalContent = !!lesson && lesson.agendaItems.length + lesson.resources.length + lesson.announcements.length > 0;
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

      {/* Opens by itself once there is optional content, so anything started (and any issue with it) is in view. */}
      <details className="rounded-md border border-falcon-brown-700/20 bg-white p-4" open={hasOptionalContent || undefined}>
        <summary className="cursor-pointer text-sm font-semibold text-falcon-brown-900">Add more (optional): agenda, resources, announcements</summary>
        <div className="mt-4 flex flex-col gap-6">
          <AgendaEditor draft={draft} onEdit={onEdit} onPendingChange={onPendingChange} />
          <ResourceEditor draft={draft} onEdit={onEdit} onPendingChange={onPendingChange} />
          <AnnouncementEditor draft={draft} onEdit={onEdit} onPendingChange={onPendingChange} />
        </div>
      </details>
    </fieldset>
  );
}

/**
 * Moves focus to the field of an item just added with an "Add" button, once
 * it has rendered. Items are added to the draft as empty entries and edited
 * in place, so the typed text is draft-backed like every other field.
 */
function useFocusNewItem(count: number, fieldId: (index: number) => string | null) {
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    const id = fieldId(count - 1);
    if (id) document.getElementById(id)?.focus();
  });
  return () => {
    pending.current = true;
  };
}

function AgendaEditor({ draft, onEdit, onPendingChange }: Pick<FirstLessonScreenProps, "draft" | "onEdit" | "onPendingChange">) {
  const items = draft.firstLesson?.agendaItems ?? [];
  const focusNew = useFocusNewItem(items.length, (index) => (items[index] ? `agenda-${items[index].id}` : null));
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
              placeholder="e.g. Warm-up problem"
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
      <div>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          onClick={() => {
            focusNew();
            onEdit((d) => startAgendaItem(d));
          }}
        >
          Add agenda item
        </button>
      </div>
    </div>
  );
}

function ResourceEditor({ draft, onEdit, onPendingChange }: Pick<FirstLessonScreenProps, "draft" | "onEdit" | "onPendingChange">) {
  const resources = draft.firstLesson?.resources ?? [];
  const focusNew = useFocusNewItem(resources.length, (index) => (resources[index] ? `resource-title-${resources[index].id}` : null));
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-falcon-brown-900">Resources</h3>
      <ul className="flex flex-col gap-3">
        {resources.map((resource, index) => (
          <li key={resource.id} className="grid gap-2 rounded-md border border-falcon-brown-700/15 p-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <label htmlFor={`resource-title-${resource.id}`} className={LABEL}>
              <span className="text-xs">Resource {index + 1} title</span>
              <DraftTextInput
                id={`resource-title-${resource.id}`}
                className={FIELD}
                placeholder="e.g. Notes slides"
                value={resource.title}
                onCommit={(value) => onEdit((d) => updateResource(d, resource.id, { title: value }))}
                onPendingChange={(pending) => onPendingChange(`resource-title-${resource.id}`, pending)}
              />
            </label>
            <label htmlFor={`resource-url-${resource.id}`} className={LABEL}>
              <span className="text-xs">Resource {index + 1} link</span>
              <DraftTextInput
                id={`resource-url-${resource.id}`}
                className={FIELD}
                type="url"
                placeholder="https://…"
                value={resource.url}
                onCommit={(value) => onEdit((d) => updateResource(d, resource.id, { url: value }))}
                onPendingChange={(pending) => onPendingChange(`resource-url-${resource.id}`, pending)}
              />
            </label>
            <button type="button" className={`${BUTTON_SECONDARY} self-end`} aria-label={`Remove resource ${index + 1}`} onClick={() => onEdit((d) => removeResource(d, resource.id))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          onClick={() => {
            focusNew();
            onEdit((d) => startResource(d));
          }}
        >
          Add resource
        </button>
      </div>
    </div>
  );
}

function AnnouncementEditor({ draft, onEdit, onPendingChange }: Pick<FirstLessonScreenProps, "draft" | "onEdit" | "onPendingChange">) {
  const announcements = draft.firstLesson?.announcements ?? [];
  const focusNew = useFocusNewItem(announcements.length, (index) => (announcements[index] ? `announcement-${announcements[index].id}` : null));
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
              placeholder="e.g. Quiz on Friday"
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
      <div>
        <button
          type="button"
          className={BUTTON_SECONDARY}
          onClick={() => {
            focusNew();
            onEdit((d) => startAnnouncement(d));
          }}
        >
          Add announcement
        </button>
      </div>
    </div>
  );
}
