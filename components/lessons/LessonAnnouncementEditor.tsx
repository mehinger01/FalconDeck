"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import type { Announcement } from "@/types/lesson";

export function LessonAnnouncementEditor({
  date,
  classSectionId,
  announcements,
}: {
  date: string;
  classSectionId: string;
  announcements: Announcement[];
}) {
  const { actions } = useAppData();
  const [text, setText] = useState("");

  return (
    <section className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
        Announcements
      </h2>

      {announcements.length === 0 ? (
        <p className="mb-3 text-sm text-falcon-brown-700/60">No announcements yet.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {announcements.map((note) => (
            <li
              key={note.id}
              className="flex items-center gap-2 rounded-lg border border-falcon-brown-700/15 bg-white p-2.5"
            >
              <input
                value={note.text}
                onChange={(e) => actions.updateAnnouncement(date, classSectionId, note.id, e.target.value)}
                className="flex-1 rounded-md border border-falcon-brown-700/20 bg-white px-2 py-1 text-sm text-falcon-brown-900"
              />
              <button
                type="button"
                onClick={() => actions.deleteAnnouncement(date, classSectionId, note.id)}
                className="rounded-md px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-800/10"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = text.trim();
          if (!trimmed) return;
          actions.addAnnouncement(date, classSectionId, trimmed);
          setText("");
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="New announcement"
          className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
        />
        <button
          type="submit"
          className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
        >
          + Add
        </button>
      </form>
    </section>
  );
}
