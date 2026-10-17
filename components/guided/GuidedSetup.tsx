"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createSetupDraftFromSeed, hasSharedScheduleChanged } from "@/lib/onboarding/setupDraft";
import { SetupDraftSession } from "@/lib/onboarding/setupDraftSession";
import type { SetupState } from "@/lib/onboarding/setupRepository";
import { adoptReportedPreferences, refreshSharedSchedule, teachingDayIssues } from "@/lib/onboarding/teachingDay";
import type { Course } from "@/types/course";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";
import { ConflictPanel } from "./ConflictPanel";
import { SaveFailedBanner, SaveStatus, saveIndicator } from "./SaveStatus";
import { createSessionStore, lazyBrowserSetupRepository, useSessionSnapshot } from "./sessionStore";
import { TeachingDayScreen } from "./TeachingDayScreen";

export interface GuidedSetupProps {
  organizationId: string;
  organizationName: string;
  setupState: Extract<SetupState, { status: "in-progress" | "not-started" }>;
  schoolSchedules: BellSchedule[];
  schoolCourses: Course[];
}

function createSession(props: GuidedSetupProps): SetupDraftSession {
  const repository = lazyBrowserSetupRepository(props.organizationId);
  if (props.setupState.status === "in-progress") {
    // Resume: the stored draft, revision and operation id. Nothing is saved until the teacher edits.
    return new SetupDraftSession(repository, props.setupState.draft, props.setupState.draft.payload, null);
  }
  // Fresh start: prefilled only from what the teacher already chose on the existing screens (the seed).
  const seed = props.setupState.seed;
  return new SetupDraftSession(repository, null, createSetupDraftFromSeed(seed, props.schoolSchedules), seed);
}

/**
 * Guided setup - this stage renders step 1, "Your teaching day". Runs
 * outside the operational app: it writes only through SetupDraftSession
 * (save_setup_draft), so nothing here creates a course, class, schedule or
 * preference until setup is completed in a later step.
 */
export function GuidedSetup(props: GuidedSetupProps) {
  const { organizationName, schoolSchedules, schoolCourses } = props;
  const [session] = useState(() => createSession(props));
  const [store] = useState(() => createSessionStore(session));
  const snapshot = useSessionSnapshot(store);
  const { draft, status, dirty } = snapshot;

  // Text typed but not yet handed to the draft (see DraftTextInput).
  const [typing, setTyping] = useState<ReadonlySet<string>>(() => new Set());
  const onPendingChange = useCallback((key: string, pending: boolean) => {
    setTyping((current) => {
      if (current.has(key) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const indicator = saveIndicator(status, dirty, typing.size > 0);
  const unsaved = dirty || typing.size > 0 || status.kind === "saving" || status.kind === "save-failed" || status.kind === "conflict";

  // Unsaved-work protection: the browser asks before leaving or reloading.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const update = useCallback((next: SetupDraft) => session.update(next), [session]);
  const editable = status.kind !== "conflict" && status.kind !== "ineligible" && status.kind !== "completed" && status.kind !== "completing";

  const scheduleChanged = draft.schedule?.mode === "shared" && hasSharedScheduleChanged(draft.schedule, schoolSchedules);
  const [removedPeriods, setRemovedPeriods] = useState<string[] | null>(null);
  const [continueAttempted, setContinueAttempted] = useState(false);
  const [readyMessage, setReadyMessage] = useState(false);
  const issues = teachingDayIssues(draft, { courses: schoolCourses, schedules: schoolSchedules });

  const onContinue = async () => {
    setContinueAttempted(true);
    setReadyMessage(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); // commit any typed text
    await session.flush();
    const current = session.getSnapshot();
    if (teachingDayIssues(current.draft, { courses: schoolCourses, schedules: schoolSchedules }).length === 0 && !current.dirty && (current.status.kind === "saved" || current.status.kind === "idle")) {
      setReadyMessage(true);
    }
  };

  if (status.kind === "ineligible") {
    return (
      <Shell organizationName={organizationName} indicator={null}>
        <div role="alert" className="rounded-lg border border-falcon-brown-700/20 bg-white p-6">
          <h2 className="text-lg font-semibold">Your account is already set up</h2>
          <p className="mt-2 text-sm text-falcon-brown-700/80">
            Classes or a schedule were added to your account outside guided setup, so there&apos;s nothing left to set up here.
          </p>
          <Link href="/setup" className="mt-4 inline-block rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100">
            Go to Falcon Deck
          </Link>
        </div>
      </Shell>
    );
  }
  if (status.kind === "completed") {
    return (
      <Shell organizationName={organizationName} indicator={null}>
        <div role="status" className="rounded-lg border border-falcon-brown-700/20 bg-white p-6">
          <h2 className="text-lg font-semibold">Setup is already finished</h2>
          <p className="mt-2 text-sm text-falcon-brown-700/80">It was completed in another tab or on another device.</p>
          <Link href="/setup" className="mt-4 inline-block rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100">
            Go to Falcon Deck
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell organizationName={organizationName} indicator={<SaveStatus indicator={indicator} onRetry={() => void session.retrySave()} />}>
      {status.kind === "save-failed" && <SaveFailedBanner message={status.message} onRetry={() => void session.retrySave()} />}

      {status.kind === "conflict" && (
        <ConflictPanel
          conflict={status}
          draft={draft}
          schoolSchedules={schoolSchedules}
          onUseSaved={() => void session.resolveConflict("use-server")}
          onKeepMine={() => void session.resolveConflict("keep-mine")}
          onAdoptPreferences={() => {
            if (status.preferences) void session.adoptPreferences(adoptReportedPreferences(draft, status.preferences, schoolSchedules));
          }}
        />
      )}

      {scheduleChanged && status.kind !== "conflict" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-falcon-gold-500 bg-white px-4 py-3 text-sm">
          <p>
            <strong>Your school changed this schedule</strong> since you chose it. Use the updated version to keep going.
          </p>
          <button
            type="button"
            className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2"
            onClick={() => {
              const refreshed = refreshSharedSchedule(draft, schoolSchedules, schoolCourses);
              setRemovedPeriods(refreshed.removedPeriods);
              update(refreshed.draft);
            }}
          >
            Use the updated schedule
          </button>
        </div>
      )}
      {removedPeriods && removedPeriods.length > 0 && (
        <p role="status" className="rounded-md bg-falcon-gold-300/20 px-4 py-2 text-sm">
          These periods are no longer in your school&apos;s schedule, so their classes were removed: {removedPeriods.join(", ")}.
        </p>
      )}

      <TeachingDayScreen
        draft={draft}
        schoolSchedules={schoolSchedules}
        schoolCourses={schoolCourses}
        disabled={!editable}
        onChange={update}
        onPendingChange={onPendingChange}
      />

      <footer className="flex flex-col gap-3 border-t border-falcon-brown-700/15 pt-4">
        {continueAttempted && issues.length > 0 && (
          <div role="alert" className="rounded-md border border-falcon-brown-700/20 bg-white px-4 py-3 text-sm">
            <p className="font-semibold">Before you continue:</p>
            <ul className="mt-1 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue.message}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
        {readyMessage && (
          <p role="status" className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
            Your teaching day is saved. The next step, your first lesson, isn&apos;t available yet in this preview.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-xs text-falcon-brown-700/70">Step 1 of 3 · Next: your first lesson</span>
          <button
            type="button"
            onClick={() => void onContinue()}
            disabled={!editable}
            className="rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-semibold text-falcon-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </footer>
    </Shell>
  );
}

function Shell({ organizationName, indicator, children }: { organizationName: string; indicator: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-falcon-brown-700/70">Set up Falcon Deck · {organizationName}</p>
          <h1 className="text-2xl font-bold text-falcon-brown-900">Your teaching day</h1>
          <p className="text-sm text-falcon-brown-700/70">Step 1 of 3. Your progress is saved as you go — you can leave and come back.</p>
        </div>
        {indicator}
      </header>
      {children}
    </main>
  );
}
