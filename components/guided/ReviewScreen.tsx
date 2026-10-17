"use client";

import { useMemo, useSyncExternalStore } from "react";
import { PreviewPresentScreen } from "@/components/present/PreviewPresentScreen";
import type { AppData } from "@/lib/data/types";
import { previewAppData, readOnlyRepository, reviewSummary } from "@/lib/onboarding/review";
import { AppDataProvider } from "@/lib/store/AppDataProvider";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";

const BUTTON_SECONDARY =
  "rounded-md border border-falcon-brown-700/30 bg-white px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";

export interface ReviewScreenProps {
  draft: SetupDraft;
  schoolSchedules: BellSchedule[];
  baseData: AppData;
  disabled: boolean;
  onEditStep: (step: "teaching-day" | "first-lesson") => void;
}

function Section({ title, editLabel, onEdit, disabled, children }: { title: string; editLabel: string; onEdit: () => void; disabled: boolean; children: React.ReactNode }) {
  const headingId = `review-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-falcon-brown-700/20 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold text-falcon-brown-900">
          {title}
        </h2>
        <button type="button" className={BUTTON_SECONDARY} onClick={onEdit} disabled={disabled}>
          {editLabel}
        </button>
      </div>
      <div className="mt-3 text-sm text-falcon-brown-800">{children}</div>
    </section>
  );
}

/** Step 3: what setup will create, with a way back to each step, and the classroom display it will produce. */
export function ReviewScreen({ draft, schoolSchedules, baseData, disabled, onEditStep }: ReviewScreenProps) {
  const summary = reviewSummary(draft, schoolSchedules);
  return (
    <div className="flex flex-col gap-4">
      <Section title="Your teaching day" editLabel="Edit teaching day" onEdit={() => onEditStep("teaching-day")} disabled={disabled}>
        <p>
          <span className="font-semibold">{summary.scheduleName ?? "No schedule chosen"}</span>
          {summary.scheduleKind && <span className="text-falcon-brown-700/70"> · {summary.scheduleKind === "school" ? "your school's schedule" : "your own schedule"}</span>}
        </p>
        <ul className="mt-2 divide-y divide-falcon-brown-700/10">
          {summary.periods.map((period) => (
            <li key={`${period.label}-${period.time}`} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>
                <span className="font-semibold">{period.label}</span> <span className="text-falcon-brown-700/70">{period.time}</span>
                {period.holdsLunch && <span className="text-falcon-brown-700/70"> · includes lunch</span>}
              </span>
              <span className={period.className ? "" : "text-falcon-brown-700/50"}>{period.className ?? "No class"}</span>
            </li>
          ))}
        </ul>
        {summary.lunch && (
          <p className="mt-2">
            Lunch: <span className="font-semibold">{summary.lunch}</span>
          </p>
        )}
      </Section>

      <Section title="Your first lesson" editLabel="Edit first lesson" onEdit={() => onEditStep("first-lesson")} disabled={disabled}>
        {summary.lesson ? (
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
            <dt className="text-falcon-brown-700/70">Class</dt>
            <dd>{summary.lesson.className ?? <span className="text-red-800">Not chosen</span>}</dd>
            <dt className="text-falcon-brown-700/70">Date</dt>
            <dd>{summary.lesson.date ?? <span className="text-red-800">Not chosen</span>}</dd>
            <dt className="text-falcon-brown-700/70">Learning target</dt>
            <dd>{summary.lesson.learningTarget || <span className="text-red-800">Not written</span>}</dd>
            {summary.lesson.agenda.length > 0 && (
              <>
                <dt className="text-falcon-brown-700/70">Agenda</dt>
                <dd>{summary.lesson.agenda.join(" · ")}</dd>
              </>
            )}
            {summary.lesson.resources.length > 0 && (
              <>
                <dt className="text-falcon-brown-700/70">Resources</dt>
                <dd>{summary.lesson.resources.join(" · ")}</dd>
              </>
            )}
            {summary.lesson.announcements.length > 0 && (
              <>
                <dt className="text-falcon-brown-700/70">Announcements</dt>
                <dd>{summary.lesson.announcements.join(" · ")}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-red-800">No first lesson yet.</p>
        )}
      </Section>

      <ClassroomPreview draft={draft} baseData={baseData} />
    </div>
  );
}

const subscribeNever = () => () => {};

/**
 * The classroom display the draft will produce, rendered by the existing
 * Preview Mode screen (the same ClassroomView Live Mode uses) inside an
 * AppDataProvider whose repository is read-only and holds the draft's
 * projection - nothing here can save anywhere. Client-only, because the
 * display reads the clock while rendering.
 */
function ClassroomPreview({ draft, baseData }: { draft: SetupDraft; baseData: AppData }) {
  const isClient = useSyncExternalStore(subscribeNever, () => true, () => false);
  const lesson = draft.firstLesson;
  const ready = lesson !== null && /^\d{4}-\d{2}-\d{2}$/.test(lesson.date) && draft.classSections.some((s) => s.id === lesson.classSectionId);
  const data = useMemo(() => previewAppData(draft, baseData, new Date(0).toISOString()), [draft, baseData]);
  const providerKey = useMemo(() => JSON.stringify(draft), [draft]);

  return (
    <section aria-labelledby="review-preview" className="rounded-lg border border-falcon-brown-700/20 bg-white p-4">
      <h2 id="review-preview" className="text-lg font-semibold text-falcon-brown-900">
        Your classroom display
      </h2>
      <p className="text-sm text-falcon-brown-700/70">A preview of what your students will see for your first lesson. Nothing is saved from here.</p>
      {isClient && ready ? (
        <div className="mt-3 overflow-hidden rounded-md border border-falcon-brown-700/20" style={{ height: 320 }} aria-hidden="true" inert>
          <div style={{ transform: "scale(0.4)", transformOrigin: "top left", width: "250%", height: 800 }}>
            <AppDataProvider key={providerKey} repository={readOnlyRepository(data)} seedData={() => data}>
              <PreviewPresentScreen date={lesson.date} classSectionId={lesson.classSectionId} block={null} />
            </AppDataProvider>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-md bg-falcon-cream-100 px-3 py-6 text-center text-sm text-falcon-brown-700/70">
          {ready ? "Loading the preview…" : "Choose your first lesson's class and date to see the preview."}
        </p>
      )}
    </section>
  );
}
