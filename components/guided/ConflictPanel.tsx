"use client";

import { useEffect, useRef } from "react";
import type { SetupSessionStatus } from "@/lib/onboarding/setupDraftSession";
import { summarizeDraft, type DraftSummary } from "@/lib/onboarding/teachingDay";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";

type Conflict = Extract<SetupSessionStatus, { kind: "conflict" }>;

const LUNCH_LABEL: Record<SetupDraft["lunchWave"], string> = { A: "A Lunch", B: "B Lunch", C: "C Lunch", none: "No lunch wave" };

function Summary({ title, summary }: { title: string; summary: DraftSummary }) {
  return (
    <div className="flex-1 rounded-md border border-falcon-brown-700/20 bg-white p-3 text-sm">
      <p className="font-semibold text-falcon-brown-900">{title}</p>
      <p className="mt-1 text-falcon-brown-700/80">
        Schedule: {summary.scheduleName ? `${summary.scheduleName} · ${summary.periodCount} period${summary.periodCount === 1 ? "" : "s"}` : "not chosen yet"}
      </p>
      <p className="text-falcon-brown-700/80">Lunch: {LUNCH_LABEL[summary.lunchWave]}</p>
      {summary.lessonTarget && <p className="text-falcon-brown-700/80">First lesson: {summary.lessonTarget}</p>}
      <p className="text-falcon-brown-700/80">
        {summary.classNames.length === 0 ? "No classes yet" : `${summary.classNames.length} class${summary.classNames.length === 1 ? "" : "es"}: ${summary.classNames.join(", ")}`}
      </p>
    </div>
  );
}

const BUTTON_PRIMARY =
  "rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2";
const BUTTON_SECONDARY =
  "rounded-md border border-falcon-brown-700/30 bg-white px-3 py-2 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2";

/**
 * Shown while autosave is paused on a conflict. Nothing is overwritten
 * until the teacher picks one of the actions here.
 */
export function ConflictPanel({
  conflict,
  draft,
  schoolSchedules,
  onUseSaved,
  onKeepMine,
  onAdoptPreferences,
  onRefreshSchedule,
}: {
  conflict: Conflict;
  draft: SetupDraft;
  schoolSchedules: BellSchedule[];
  onUseSaved: () => void;
  onKeepMine: () => void;
  onAdoptPreferences: () => void;
  onRefreshSchedule: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [conflict.reason]);

  let title: string;
  let body: React.ReactNode;
  let actions: React.ReactNode;

  if (conflict.reason === "shared-schedule-changed") {
    title = "Your school updated its schedule";
    body = (
      <p>
        Setup can&apos;t finish against a schedule you haven&apos;t seen. Get the latest version and check your periods. Classes in periods that
        still exist, and your first lesson, are kept.
      </p>
    );
    actions = (
      <button type="button" className={BUTTON_PRIMARY} onClick={onRefreshSchedule}>
        Get the latest schedule and review
      </button>
    );
  } else if (conflict.reason === "preferences-changed" && conflict.preferences) {
    const reported = conflict.preferences;
    const scheduleName = reported.activeBellScheduleId
      ? (schoolSchedules.find((schedule) => schedule.id === reported.activeBellScheduleId)?.name ?? "a schedule")
      : null;
    const switchesSchedule =
      reported.activeBellScheduleId !== null &&
      !(draft.schedule?.mode === "shared" && draft.schedule.scheduleId === reported.activeBellScheduleId);
    title = "Your schedule settings changed in another window";
    body = (
      <>
        <p>
          Since this setup started, your {scheduleName ? <>active schedule became <strong>{scheduleName}</strong> and your </> : null}
          lunch wave became <strong>{LUNCH_LABEL[reported.lunchWave]}</strong>. Setup won&apos;t replace a choice you made elsewhere.
        </p>
        {switchesSchedule && draft.classSections.length > 0 && (
          <p className="mt-2">
            Using it switches this setup to {scheduleName}, so you&apos;ll need to place your classes in its periods again. Your first lesson is
            kept; you&apos;ll just choose its class again.
          </p>
        )}
      </>
    );
    actions = (
      <button type="button" className={BUTTON_PRIMARY} onClick={onAdoptPreferences}>
        Use these settings and continue
      </button>
    );
  } else if (conflict.serverDraft) {
    title = "This setup was changed in another tab or device";
    body = (
      <>
        <p>Choose which version to keep. The other one will be replaced.</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Summary title="On this screen" summary={summarizeDraft(draft, schoolSchedules)} />
          <Summary title="Saved version" summary={summarizeDraft(conflict.serverDraft.payload, schoolSchedules)} />
        </div>
      </>
    );
    actions = (
      <>
        <button type="button" className={BUTTON_PRIMARY} onClick={onUseSaved}>
          Use the saved version
        </button>
        <button type="button" className={BUTTON_SECONDARY} onClick={onKeepMine}>
          Keep what&apos;s on this screen
        </button>
      </>
    );
  } else {
    title = "The saved copy of this setup is gone";
    body = <p>What&apos;s on this screen is still here. Save it again to keep going.</p>;
    actions = (
      <button type="button" className={BUTTON_PRIMARY} onClick={onKeepMine}>
        Save what&apos;s on this screen
      </button>
    );
  }

  return (
    <section
      role="alertdialog"
      aria-labelledby="setup-conflict-title"
      className="rounded-lg border-2 border-falcon-gold-500 bg-falcon-gold-300/20 p-4 text-sm text-falcon-brown-900"
    >
      <h2 id="setup-conflict-title" ref={heading} tabIndex={-1} className="text-base font-bold focus:outline-none">
        {title}
      </h2>
      <div className="mt-2">{body}</div>
      <p className="mt-2 text-xs text-falcon-brown-700/70">Saving is paused until you choose.</p>
      <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
    </section>
  );
}
