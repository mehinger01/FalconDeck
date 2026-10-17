"use client";

import type { SetupSessionStatus } from "@/lib/onboarding/setupDraftSession";

export type SaveIndicator =
  | { tone: "quiet"; label: string }
  | { tone: "busy"; label: string }
  | { tone: "ok"; label: string }
  | { tone: "warn"; label: string; detail?: string; canRetry: boolean };

/**
 * What the teacher is told about their work, from the session's status plus
 * text still being typed. "Not saved" is never shown as anything softer, and
 * nothing that is unsaved is ever shown as "Saved".
 */
export function saveIndicator(status: SetupSessionStatus, dirty: boolean, typing: boolean, hasSavedDraft = false): SaveIndicator {
  switch (status.kind) {
    case "save-failed":
      return { tone: "warn", label: "Not saved", canRetry: true };
    case "conflict":
      return { tone: "warn", label: "Not saved — needs your choice", canRetry: false };
    case "ineligible":
      return { tone: "warn", label: "Not saved", canRetry: false };
    case "saving":
    case "completing":
      return { tone: "busy", label: "Saving…" };
    default:
      if (typing || dirty) return { tone: "busy", label: "Unsaved changes…" };
      // A resumed draft is already saved, even before this visit's first save.
      if (status.kind === "saved" || status.kind === "completed" || hasSavedDraft) return { tone: "ok", label: "All changes saved" };
      return { tone: "quiet", label: "Nothing to save yet" };
  }
}

const TONE_CLASS: Record<SaveIndicator["tone"], string> = {
  quiet: "border-falcon-brown-700/20 text-falcon-brown-700/70",
  busy: "border-falcon-gold-500 bg-falcon-gold-300/20 text-falcon-brown-900",
  ok: "border-emerald-700/30 bg-emerald-50 text-emerald-900",
  warn: "border-red-700/40 bg-red-50 text-red-900",
};

export function SaveStatus({ indicator, onRetry }: { indicator: SaveIndicator; onRetry: () => void }) {
  return (
    <div
      role={indicator.tone === "warn" ? "alert" : "status"}
      aria-live={indicator.tone === "warn" ? "assertive" : "polite"}
      className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold ${TONE_CLASS[indicator.tone]}`}
    >
      <span>{indicator.label}</span>
      {indicator.tone === "warn" && indicator.canRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-red-900 px-2 py-0.5 text-xs font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-900 focus-visible:ring-offset-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Full-width notice under the header while a save has failed - the edits are
 * kept, and the teacher is told so in plain words. The technical reason
 * (e.g. a browser's "Failed to fetch") is available on hover, not shown.
 */
export function SaveFailedBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-700/40 bg-red-50 px-4 py-3 text-sm text-red-900">
      <p title={message}>
        <strong>Your latest changes aren&apos;t saved yet.</strong> They&apos;re still on this screen. Check your connection,
        then try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-red-900 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-900 focus-visible:ring-offset-2"
      >
        Try saving again
      </button>
    </div>
  );
}
