"use client";

import { useState } from "react";
import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import type { ResourceOverlayContent } from "@/types/classroomTools";
import { QrCodeDisplay } from "./QrCodeDisplay";

export type { ResourceOverlayContent };

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Full-screen student-facing display for a single resource - used by both
 * the Quick Resource tool (a resource already on the current lesson) and
 * the QR Code tool (that same resource, or a teacher-entered URL), so
 * there is one resource-display implementation, not two. A pure UI
 * overlay: it never touches `DailyLesson` or schedule state.
 */
export function ResourceOverlay({
  content,
  onClose,
}: {
  content: ResourceOverlayContent;
  onClose: () => void;
}) {
  const [showQr, setShowQr] = useState(true);

  return (
    <div className="animate-present-fade fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-falcon-brown-950 px-10 text-center">
      {content.type && (
        <p className="text-sm font-bold uppercase tracking-[0.3em] text-falcon-gold-400">
          {RESOURCE_TYPE_LABELS[content.type]}
        </p>
      )}
      <h1 className="text-4xl font-black text-falcon-cream-100 sm:text-5xl">{content.title}</h1>

      {showQr ? (
        <div className="flex flex-col items-center gap-3">
          <QrCodeDisplay url={content.url} />
          <p className="text-sm text-falcon-cream-200/60">{domainOf(content.url)}</p>
        </div>
      ) : (
        <p className="max-w-lg text-balance break-words text-falcon-cream-200/70">{content.url}</p>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <a
          href={content.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-falcon-gold-400 px-4 py-2 text-sm font-bold text-falcon-brown-950 hover:bg-falcon-gold-300"
        >
          Open
        </a>
        <button
          type="button"
          onClick={() => setShowQr((current) => !current)}
          className="rounded-md border border-falcon-cream-200/30 px-4 py-2 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-cream-200/10"
        >
          {showQr ? "Hide QR" : "Show QR"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-falcon-cream-200/30 px-4 py-2 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-cream-200/10"
        >
          Close
        </button>
      </div>
    </div>
  );
}
