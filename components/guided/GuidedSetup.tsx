"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deepEqual } from "@/lib/data/supabaseMapping";
import type { AppData } from "@/lib/data/types";
import { firstLessonIssues, setStep } from "@/lib/onboarding/firstLesson";
import { baseAppData, reviewIssues, type ReviewIssue } from "@/lib/onboarding/review";
import { createSetupDraftFromSeed, hasSharedScheduleChanged } from "@/lib/onboarding/setupDraft";
import { SetupDraftSession } from "@/lib/onboarding/setupDraftSession";
import type { SetupRepository, SetupState } from "@/lib/onboarding/setupRepository";
import { adoptReportedPreferences, refreshSharedSchedule, teachingDayIssues } from "@/lib/onboarding/teachingDay";
import type { SchoolYearCalendar } from "@/types/calendar";
import type { Course } from "@/types/course";
import type { BellSchedule } from "@/types/schedule";
import type { SetupDraft, SetupStep } from "@/types/setupDraft";
import { ConflictPanel } from "./ConflictPanel";
import { FirstLessonScreen } from "./FirstLessonScreen";
import { ReviewScreen } from "./ReviewScreen";
import { SaveFailedBanner, SaveStatus, saveIndicator } from "./SaveStatus";
import { createSessionStore, lazyBrowserSetupRepository, useSessionSnapshot } from "./sessionStore";
import { TeachingDayScreen } from "./TeachingDayScreen";

/** The school's read-only data the screens work against - reloadable when a conflict says it changed. */
export interface GuidedReference {
  schoolSchedules: BellSchedule[];
  schoolCourses: Course[];
  schoolCalendar: SchoolYearCalendar | null;
  /** The teacher's current readable data - what the classroom preview is projected onto. */
  baseData: AppData;
}

export interface GuidedSetupProps {
  organizationId: string;
  organizationName: string;
  setupState: Extract<SetupState, { status: "in-progress" | "not-started" }>;
  schoolSchedules: BellSchedule[];
  schoolCourses: Course[];
  /** The school year calendar the teacher already sees, if any - used only to describe a chosen lesson date. */
  schoolCalendar?: SchoolYearCalendar | null;
  /** The teacher's current readable data, for the classroom preview. Defaults to an empty AppData around the school's data. */
  baseData?: AppData;
  /** Re-reads the reference data from the server (app/(guided)/start/actions.ts). Without it, recovery uses what the page loaded with. */
  reloadReference?: () => Promise<GuidedReference | null>;
  /** After setup commits. Defaults to a full navigation to /present, so the display loads the committed data fresh. */
  onCompleted?: () => void;
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

const STEPS: Record<SetupStep, { number: number; title: string }> = {
  "teaching-day": { number: 1, title: "Your teaching day" },
  "first-lesson": { number: 2, title: "Your first lesson" },
  review: { number: 3, title: "Review and start" },
};

const BUTTON_PRIMARY =
  "rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-semibold text-falcon-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";
const BUTTON_SECONDARY =
  "rounded-md border border-falcon-brown-700/30 bg-white px-4 py-2 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-falcon-gold-500 focus-visible:ring-offset-2 disabled:opacity-50";

/**
 * A full document load on purpose, not a client-side route change: /present
 * then mounts a brand-new CutoverAppDataProvider whose first load() reads
 * the rows complete_setup just committed - nothing cached from before
 * completion can be carried across.
 */
// eslint-disable-next-line @next/next/no-location-assign-relative-destination
const openClassroomDisplay = () => window.location.assign("/present");

/**
 * Guided setup: "Your teaching day", "Your first lesson", "Review and
 * start". Runs outside the operational app and writes only through
 * SetupDraftSession: drafts through save_setup_draft, and - from the review
 * step only - the one commit through complete_setup. On success it leaves
 * with a full navigation to /present, whose provider loads the committed
 * rows from the database.
 */
export function GuidedSetup(props: GuidedSetupProps) {
  const { organizationName } = props;
  const [session] = useState(() => createSession(props));
  const [store] = useState(() => createSessionStore(session));
  const snapshot = useSessionSnapshot(store);
  const { draft, status, dirty } = snapshot;
  const step: SetupStep = draft.step;

  const [reference, setReference] = useState<GuidedReference>(() => ({
    schoolSchedules: props.schoolSchedules,
    schoolCourses: props.schoolCourses,
    schoolCalendar: props.schoolCalendar ?? null,
    baseData: props.baseData ?? baseAppData({ schedules: props.schoolSchedules, courses: props.schoolCourses, calendar: props.schoolCalendar ?? null }),
  }));
  const { schoolSchedules, schoolCourses, schoolCalendar } = reference;

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
   * is committed - never to a copy captured by an earlier render (a late
   * commit must not restore an old draft). A change that alters nothing is
   * not saved.
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
  const unsaved =
    dirty || typing.size > 0 || status.kind === "saving" || status.kind === "save-failed" || status.kind === "conflict" || status.kind === "completing";

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
  const [continueAttempted, setContinueAttempted] = useState<SetupStep | null>(null);

  const issueReference = { courses: schoolCourses, schedules: schoolSchedules };
  const stepIssues: string[] =
    step === "teaching-day"
      ? teachingDayIssues(draft, issueReference).map((issue) => issue.message)
      : step === "first-lesson"
        ? firstLessonIssues(draft)
        : reviewIssues(draft, issueReference).map((issue) => issue.message);

  // Move focus to the new step's heading, so keyboard and screen-reader users land at its top.
  const heading = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    window.scrollTo({ top: 0 });
    heading.current?.focus();
  }, [step]);

  /** Commits typed text and waits for the save, so leaving a step never leaves edits behind. */
  const settle = async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await session.flush();
  };
  const isSettled = () => {
    const current = session.getSnapshot();
    return !current.dirty && (current.status.kind === "saved" || current.status.kind === "idle");
  };

  const goTo = async (target: SetupStep) => {
    setContinueAttempted(null);
    await settle();
    edit((d) => setStep(d, target));
  };

  const onContinue = async () => {
    setContinueAttempted(step);
    await settle();
    if (!isSettled()) return;
    const current = session.getSnapshot().draft;
    if (step === "teaching-day" && teachingDayIssues(current, issueReference).length === 0) {
      setContinueAttempted(null);
      edit((d) => setStep(d, "first-lesson"));
    } else if (step === "first-lesson" && firstLessonIssues(current).length === 0) {
      setContinueAttempted(null);
      edit((d) => setStep(d, "review"));
    }
  };

  // --- completion ------------------------------------------------------------

  const submitting = useRef(false);
  const [finishIssues, setFinishIssues] = useState<ReviewIssue[] | null>(null);
  // True once this tab is about to open the classroom display; a tab that only learns setup finished elsewhere offers the link instead.
  const [opening, setOpening] = useState(false);
  const onCompleted = () => {
    setOpening(true);
    (props.onCompleted ?? openClassroomDisplay)();
  };

  /**
   * Saves anything outstanding, then commits through complete_setup. One
   * request at a time: a second click while this runs does nothing. The
   * operation id is fixed for the draft, so pressing again after an
   * unconfirmed result asks about the same operation - a commit that landed
   * is answered from the server's record, never performed twice.
   */
  const onFinish = async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      setFinishIssues(null);
      await settle();
      const afterSave = session.getSnapshot();
      // A save can learn that setup already committed (an earlier answer was lost): that is success.
      if (afterSave.status.kind === "completed") return onCompleted();
      // Unsaved work, or a failed save, conflict or ineligibility, is shown instead. An unconfirmed or
      // refused completion is not a blocker: completing again asks about the same operation.
      if (afterSave.dirty || ["save-failed", "conflict", "ineligible", "saving"].includes(afterSave.status.kind)) return;
      const issues = reviewIssues(session.getSnapshot().draft, issueReference);
      if (issues.length > 0) {
        setFinishIssues(issues);
        return;
      }
      const outcome = await session.complete();
      if (outcome.kind === "completed") onCompleted();
    } finally {
      submitting.current = false;
    }
  };

  // --- recovery ----------------------------------------------------------------

  const reloadReference = async (): Promise<GuidedReference> => {
    const fresh = props.reloadReference ? await props.reloadReference().catch(() => null) : null;
    if (!fresh) return reference;
    setReference(fresh);
    return fresh;
  };

  /** A school schedule changed: take the latest version, keep what still fits, and send the teacher to review it. */
  const onRefreshSchedule = async () => {
    const fresh = await reloadReference();
    edit((d) => {
      const refreshed = refreshSharedSchedule(d, fresh.schoolSchedules, fresh.schoolCourses);
      setRemovedPeriods(refreshed.removedPeriods);
      return setStep(refreshed.draft, "teaching-day");
    });
    await session.resolveConflict("keep-mine");
  };

  /** Schedule preferences changed elsewhere: adopt them (never overwrite them). A changed schedule means placing classes again. */
  const onAdoptPreferences = async () => {
    if (status.kind !== "conflict" || !status.preferences) return;
    const preferences = status.preferences;
    const fresh = await reloadReference();
    const current = session.getSnapshot().draft;
    let rebuilt = adoptReportedPreferences(current, preferences, fresh.schoolSchedules);
    // A different schedule means placing classes again: review it on step 1.
    if (!deepEqual(rebuilt.schedule, current.schedule)) rebuilt = setStep(rebuilt, "teaching-day");
    await session.adoptPreferences(rebuilt);
  };

  // --- rendering -----------------------------------------------------------------

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
        <div role="status" className="rounded-lg border border-emerald-700/30 bg-emerald-50 p-6 text-emerald-950">
          <h2 className="text-lg font-semibold">Your classroom is ready</h2>
          <p className="mt-2 text-sm">{opening ? "Setup is finished. Opening your classroom display…" : "Setup is finished."}</p>
          <a href="/present" className="mt-4 inline-block rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100">
            Open your classroom display
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
          onAdoptPreferences={() => void onAdoptPreferences()}
          onRefreshSchedule={() => void onRefreshSchedule()}
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
                return setStep(refreshed.draft, "teaching-day");
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

      {step === "teaching-day" && (
        <TeachingDayScreen
          draft={draft}
          schoolSchedules={schoolSchedules}
          schoolCourses={schoolCourses}
          disabled={!editable}
          onEdit={edit}
          onPendingChange={onPendingChange}
        />
      )}
      {step === "first-lesson" && (
        <FirstLessonScreen
          draft={draft}
          schoolSchedules={schoolSchedules}
          schoolCalendar={schoolCalendar}
          disabled={!editable}
          onEdit={edit}
          onPendingChange={onPendingChange}
        />
      )}
      {step === "review" && (
        <ReviewScreen draft={draft} schoolSchedules={schoolSchedules} baseData={reference.baseData} disabled={!editable} onEditStep={(target) => void goTo(target)} />
      )}

      <footer className="flex flex-col gap-3 border-t border-falcon-brown-700/15 pt-4">
        {step !== "review" && continueAttempted === step && stepIssues.length > 0 && (
          <div role="alert" className="rounded-md border border-falcon-brown-700/20 bg-white px-4 py-3 text-sm">
            <p className="font-semibold">Before you continue:</p>
            <ul className="mt-1 list-disc pl-5">
              {stepIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        {step === "review" && <CompletionStatus status={status} finishIssues={finishIssues} onFix={(target) => void goTo(target)} />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {step !== "teaching-day" ? (
            <button type="button" className={BUTTON_SECONDARY} onClick={() => void goTo(step === "review" ? "first-lesson" : "teaching-day")} disabled={!editable}>
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-3">
            {step === "review" ? (
              <button
                type="button"
                onClick={() => void onFinish()}
                disabled={!editable || status.kind === "save-failed"}
                aria-busy={status.kind === "completing"}
                className={BUTTON_PRIMARY}
              >
                {status.kind === "completing" ? "Starting your classroom…" : status.kind === "completion-unconfirmed" ? "Try again" : "Start my classroom"}
              </button>
            ) : (
              <>
                <span className="text-xs text-falcon-brown-700/70">
                  Step {STEPS[step].number} of 3 · Next: {step === "teaching-day" ? "your first lesson" : "review and start"}
                </span>
                <button type="button" onClick={() => void onContinue()} disabled={!editable} className={BUTTON_PRIMARY}>
                  Continue
                </button>
              </>
            )}
          </div>
        </div>
      </footer>
    </Shell>
  );
}

/** What the teacher is told on the review step about finishing. */
function CompletionStatus({
  status,
  finishIssues,
  onFix,
}: {
  status: ReturnType<SetupDraftSession["getSnapshot"]>["status"];
  finishIssues: ReviewIssue[] | null;
  onFix: (step: "teaching-day" | "first-lesson") => void;
}) {
  if (status.kind === "completing") {
    return (
      <p role="status" className="rounded-md bg-falcon-gold-300/20 px-4 py-2 text-sm">
        Creating your classes, schedule and first lesson… This takes a moment. Please keep this page open.
      </p>
    );
  }
  if (status.kind === "completion-unconfirmed") {
    return (
      <div role="alert" className="rounded-md border border-red-700/40 bg-red-50 px-4 py-3 text-sm text-red-900">
        <p className="font-semibold">We couldn&apos;t confirm that setup finished.</p>
        <p>Check your connection and press Try again. Your setup won&apos;t be created twice - trying again finishes it or confirms it already did.</p>
      </div>
    );
  }
  if (status.kind === "completion-rejected") {
    return (
      <div role="alert" className="rounded-md border border-red-700/40 bg-red-50 px-4 py-3 text-sm text-red-900">
        <p className="font-semibold">Setup couldn&apos;t finish. Nothing was created.</p>
        <p>
          {status.userFacing
            ? status.message
            : "Something went wrong on our side. Your setup is saved - press Start my classroom to try again, or come back later."}
        </p>
      </div>
    );
  }
  if (finishIssues && finishIssues.length > 0) {
    return (
      <div role="alert" className="rounded-md border border-falcon-brown-700/20 bg-white px-4 py-3 text-sm">
        <p className="font-semibold">Before you start:</p>
        <ul className="mt-1 flex flex-col gap-1">
          {finishIssues.map((issue) => (
            <li key={issue.message} className="flex flex-wrap items-center gap-2">
              <span>{issue.message}</span>
              <button type="button" className="text-sm font-semibold underline decoration-falcon-gold-500 decoration-2 underline-offset-2" onClick={() => onFix(issue.step)}>
                Fix this
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p className="text-sm text-falcon-brown-700/80">
      Starting creates your classes, schedule and first lesson, then opens your classroom display. You can change any of it later.
    </p>
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
  step: SetupStep;
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
