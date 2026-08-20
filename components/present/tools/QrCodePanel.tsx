"use client";

import { useState } from "react";
import type { DailyLesson } from "@/types/lesson";
import type { ResourceOverlayContent } from "./ResourceOverlay";
import { QuickResourcePanel } from "./QuickResourcePanel";

/**
 * The QR Code tool's tray controls: generate from a resource already on
 * the current lesson (reuses `QuickResourcePanel`'s list - one resource
 * list, not two), or from a teacher-entered URL. Either path ends at the
 * same `ResourceOverlay`.
 */
export function QrCodePanel({
  lesson,
  onGenerate,
}: {
  lesson: DailyLesson | null;
  onGenerate: (content: ResourceOverlayContent) => void;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-falcon-cream-200/50">
          From this lesson
        </p>
        <QuickResourcePanel
          lesson={lesson}
          onSelect={(resource) => onGenerate({ title: resource.title, url: resource.url, type: resource.type })}
        />
      </div>

      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-falcon-cream-200/50">Custom URL</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmedUrl = url.trim();
            if (!trimmedUrl) return;
            onGenerate({ title: title.trim() || trimmedUrl, url: trimmedUrl });
            setTitle("");
            setUrl("");
          }}
          className="flex flex-col gap-1.5"
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (optional)"
            className="rounded border border-falcon-cream-200/20 bg-falcon-brown-900 px-2 py-1 text-sm text-falcon-cream-100"
          />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            className="rounded border border-falcon-cream-200/20 bg-falcon-brown-900 px-2 py-1 text-sm text-falcon-cream-100"
          />
          <button
            type="submit"
            className="rounded-md bg-falcon-gold-400 px-3 py-1.5 text-sm font-bold text-falcon-brown-950 hover:bg-falcon-gold-300"
          >
            Generate QR Code
          </button>
        </form>
      </div>
    </div>
  );
}
