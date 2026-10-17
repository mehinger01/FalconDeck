"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deepEqual } from "@/lib/data/supabaseMapping";
import { firstLessonIssues, setStep } from "@/lib/onboarding/firstLesson";
import { createSetupDraftFromSeed, hasSharedScheduleChanged } from "@/lib/onboarding/setupDraft";
import { SetupDraftSession } from "@/lib/onboarding/setupDraftSession";
import type { SetupRepository, SetupState } from "@/lib/onboarding/setupRepository";
import { adoptReportedPreferences, refreshSharedSchedule, teachingDayIssues } from "@/lib/onboarding/teachingDay";
import type { SchoolYearCalendar } from "@/types/calendar";
import type { Course } from "@/types/course";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft } from "@/types/setupDraft";
import { ConflictPanel } from "./ConflictPanel";
import { FirstLessonScreen } from "./FirstLessonScreen";
import { SaveFailedBanner, SaveStatus, saveIndicator } from "./SaveStatus";
import { createSessionStore, lazyBrowserSetupRepository, useSessionSnapshot } from "./sessionStore";
import { TeachingDayScreen } from "./TeachingDayScreen";

export interface GuidedSetupProps {
  organizationId: string;
  organizationName: string;
  setupState: Extract<SetupState, { status: "in-progress" | "not-started" }>;
  schoolSchedules: BellSchedule[];
  schoolCourses: Course[];
  /** The school year calendar the teacher already sees, if any - used only to describe a chosen lesson date. */
  schoolCalendar?: SchoolYearCalendar | null;
  /** Tests only (scripts/support/guidedSetupHarness.tsx): an in-memory repository. Production passes nothing. */
  repository?: SetupRepository;
}

export type DraftEdit = (change: (draft: SetupDraft) => SetupDraft) => void;

function createSession(props: GuidedSetupProps): SetupDraftSession {
  const repository = props.repository ?? lazyBrowserSetupRepository(props.organizationId);
  if (props.setupState.status === "in-progress") {
    // Resume: the stored draft, revision and operation id - and the step it was on. Nothing is saved until the teacher edits.
    return new SetupDraftSession(repository, props.setupState.draft, props.setupState.draft.payload, null);
  }
  // Fresh start: prefilled only from what the teacher already chose on the existing screens (the seed).
  const seed = props.setupState.seed;
  return new SetupDraftSession(repository, null, createSetupDraftFromSeed(seed, props.schoolSchedules), seed);
}

const STEPS = {
  "teaching-day": { number: 1, title: "Your teaching day" },
  "first-lesson": { number: 2, title: "Your first lesson" },
} as const;
type ShownStep = keyof typeof STEPS;

const BUTTON_PRIMARY =
  "rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-semibold text-falcon-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";
const BUTTON_SECONDARY =
  "rounded-md border border-falcon-brown-700/30 bg-white px-4 py-2 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";

/**
 * Guided setup - steps 1 ("Your teaching day") and 2 ("Your first lesson").
 * Runs outside the operational app: it writes only through
 * SetupDraftSession (save_setup_draft), so nothing here creates a course,
 * class, schedule, lesson or preference, and complete_setup is never called
 * (the review step that will is not built yet).
 */
export function GuidedSetup(props: GuidedSetupProps) {
  const { organizationName, schoolSchedules, schoolCourses } = props;
  const schoolCalendar = props.schoolCalendar ?? null;
  const [session] = useState(() => createSession(props));
  const [store] = useState(() => createSessionStore(session));
  const snapshot = useSessionSnapshot(store);
  const { draft, status, dirty } = snapshot;
  // The review step is not built yet; a draft resumed there opens on the lesson step.
  const step: ShownStep = draft.step === "teaching-day" ? "teaching-day" : "first-lesson";

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

  /**
   * Every change is applied to the session's CURRENT draft at the moment it
   * is committed - never to a copy captured by an earlier render. A field
   * whose text commits late (debounce, unmount, Safari not blurring on a
   * button tap) therefore edits what is there now: if its period was removed
   * meanwhile, the change is a no-op instead of restoring the old draft. A
   * change that alters nothing is not saved.
   */
  const edit: DraftEdit = useCallback(
    (change) => {
      const current = session.getSnapshot().draft;
      const next = change(current);
      if (!deepEqual(next, current)) session.update(next);
    },
    [session],
  );

  const indicator = saveIndicator(status, dirty, typing.size > 0, props.setupState.status === "in-progress");
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

  const editable = status.kind !== "conflict" && status.kind !== "ineligible" && status.kind !== "completed" && status.kind !== "completing";
  const scheduleChanged = draft.schedule?.mode === "shared" && hasSharedScheduleChanged(draft.schedule, schoolSchedules);
  const [removedPeriods, setRemovedPeriods] = useState<string[] | null>(null);
  const [continueAttempted, setContinueAttempted] = useState<ShownStep | null>(null);
  const [lessonReady, setLessonReady] = useState(false);

  const reference = { courses: schoolCourses, schedules: schoolSchedules };
  const issues = step === "teaching-day" ? teachingDayIssues(draft, reference).map((issue) => issue.message) : firstLessonIssues(draft);

  // Move focus to the new step's heading, so keyboard and screen-reader users land at its top.
  const heading = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    window.scrollTo({ top: 0 });
    heading.current?.focus();
  }, [step]);

  /** Commits typed text and waits for the save, so a step change never leaves edits behind. */
  const settle = async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await session.flush();
  };

  const onContinue = async () => {
    setContinueAttempted(step);
    setLessonReady(false);
    await settle();
    const current = session.getSnapshot();
    const settled = !current.dirty && (current.status.kind === "saved" || current.status.kind === "idle");
    if (!settled) return;
    if (step === "teaching-day") {
      if (teachingDayIssues(current.draft, reference).length > 0) return;
      setContinueAttempted(null);
      edit((d) => setStep(d, "first-lesson"));
    } else if (firstLessonIssues(current.draft).length === 0) {
      setLessonReady(true);
    }
  };

  const onBack = async () => {
    setLessonReady(false);
    setContinueAttempted(null);
    await settle();
    edit((d) => setStep(d, "teaching-day"));
  };

  if (status.kind === "ineligible") {
    return (
      <Shell organizationName={organizationName} step={step} heading={heading} indicator={null}>
        <div role="alert" className="rounded-lg border border-falcon-brown-700/20 bg-white p-6">
          <h2 className="text-lg font-semibold">Your account is already set up</h2>
          <p className="mt-2 text-sm text-falcon-brown-700/80">
            Classes or a schedule were added to your account outside guided setup, so there&apos;s nothing left to set up here.
          </p>
          <a href="/setup" className="mt-4 inline-block rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100">
            Go to Falcon Deck
          </a>
        </div>
      </Shell>
    );
  }
  if (status.kind === "completed") {
    return (
      <Shell organizationName={organizationName} step={step} heading={heading} indicator={null}>
        <div role="status" className="rounded-lg border border-falcon-brown-700/20 bg-white p-6">
          <h2 className="text-lg font-semibold">Setup is already finished</h2>
          <p className="mt-2 text-sm text-falcon-brown-700/80">It was completed in another tab or on another device.</p>
          <a href="/setup" className="mt-4 inline-block rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100">
            Go to Falcon Deck
          </a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      organizationName={organizationName}
      step={step}
      heading={heading}
      indicator={<SaveStatus indicator={indicator} onRetry={() => void session.retrySave()} />}
    >
      {status.kind === "save-failed" && <SaveFailedBanner message={status.message} onRetry={() => void session.retrySave()} />}

      {status.kind === "conflict" && (
        <ConflictPanel
          conflict={status}
          draft={draft}
          schoolSchedules={schoolSchedules}
          onUseSaved={() => void session.resolveConflict("use-server")}
          onKeepMine={() => void session.resolveConflict("keep-mine")}
          onAdoptPreferences={() => {
            if (status.preferences) void session.adoptPreferences(adoptReportedPreferences(session.getSnapshot().draft, status.preferences, schoolSchedules));
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
            onClick={() =>
              edit((d) => {
                const refreshed = refreshSharedSchedule(d, schoolSchedules, schoolCourses);
                setRemovedPeriods(refreshed.removedPeriods);
                return refreshed.draft;
              })
            }
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

      {step === "teaching-day" ? (
        <TeachingDayScreen
          draft={draft}
          schoolSchedules={schoolSchedules}
          schoolCourses={schoolCourses}
          disabled={!editable}
          onEdit={edit}
          onPendingChange={onPendingChange}
        />
      ) : (
        <FirstLessonScreen
          draft={draft}
          schoolSchedules={schoolSchedules}
          schoolCalendar={schoolCalendar}
          disabled={!editable}
          onEdit={edit}
          onPendingChange={onPendingChange}
        />
      )}

      <footer className="flex flex-col gap-3 border-t border-falcon-brown-700/15 pt-4">
        {continueAttempted === step && issues.length > 0 && (
          <div role="alert" className="rounded-md border border-falcon-brown-700/20 bg-white px-4 py-3 text-sm">
            <p className="font-semibold">Before you continue:</p>
            <ul className="mt-1 list-disc pl-5">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {lessonReady && step === "first-lesson" && (
          <p role="status" className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
            Your first lesson is saved. The last step, reviewing and starting your classroom display, isn&apos;t available yet in this preview.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {step === "first-lesson" ? (
            <button type="button" className={BUTTON_SECONDARY} onClick={() => void onBack()} disabled={!editable}>
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-falcon-brown-700/70">
              Step {STEPS[step].number} of 3 · Next: {step === "teaching-day" ? "your first lesson" : "review and start"}
            </span>
            <button type="button" onClick={() => void onContinue()} disabled={!editable} className={BUTTON_PRIMARY}>
              Continue
            </button>
          </div>
        </div>
      </footer>
    </Shell>
  );
}

function Shell({
  organizationName,
  step,
  heading,
  indicator,
  children,
}: {
  organizationName: string;
  step: ShownStep;
  heading: React.RefObject<HTMLHeadingElement | null>;
  indicator: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-falcon-brown-700/70">Set up Falcon Deck · {organizationName}</p>
          <h1 ref={heading} tabIndex={-1} className="text-2xl font-bold text-falcon-brown-900 focus:outline-none">
            {STEPS[step].title}
          </h1>
          <p className="text-sm text-falcon-brown-700/70">Step {STEPS[step].number} of 3. Your progress is saved as you go — you can leave and come back.</p>
        </div>
        {indicator}
      </header>
      {children}
    </main>
  );
}
