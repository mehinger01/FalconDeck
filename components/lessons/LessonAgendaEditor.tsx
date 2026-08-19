"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import type { AgendaItem } from "@/types/lesson";

export function LessonAgendaEditor({
  date,
  classSectionId,
  agendaItems,
}: {
  date: string;
  classSectionId: string;
  agendaItems: AgendaItem[];
}) {
  const { actions } = useAppData();
  const [newTitle, setNewTitle] = useState("");
  const items = [...agendaItems].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
        Agenda
      </h2>

      {items.length === 0 ? (
        <p className="mb-3 text-sm text-falcon-brown-700/60">No agenda items yet.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="rounded-lg border border-falcon-brown-700/15 bg-white p-2.5"
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={item.isCompleted}
                  onChange={() => actions.toggleAgendaItemCompleted(date, classSectionId, item.id)}
                  className="mt-2"
                  aria-label={`Mark "${item.title}" ${item.isCompleted ? "incomplete" : "complete"}`}
                />
                <div className="min-w-0 flex-1">
                  <input
                    value={item.title}
                    onChange={(e) =>
                      actions.updateAgendaItem(date, classSectionId, item.id, {
                        title: e.target.value,
                      })
                    }
                    className="w-full rounded-md border border-falcon-brown-700/20 bg-white px-2 py-1 text-sm font-medium text-falcon-brown-900"
                  />
                  <input
                    value={item.details ?? ""}
                    onChange={(e) =>
                      actions.updateAgendaItem(date, classSectionId, item.id, {
                        details: e.target.value,
                      })
                    }
                    placeholder="Optional details"
                    className="mt-1 w-full rounded-md border border-falcon-brown-700/20 bg-white px-2 py-1 text-xs text-falcon-brown-900"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    aria-label="Move earlier"
                    disabled={index === 0}
                    onClick={() => actions.reorderAgendaItem(date, classSectionId, item.id, "up")}
                    className="rounded-md border border-falcon-brown-700/30 px-1.5 py-0.5 text-xs text-falcon-brown-900 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move later"
                    disabled={index === items.length - 1}
                    onClick={() => actions.reorderAgendaItem(date, classSectionId, item.id, "down")}
                    className="rounded-md border border-falcon-brown-700/30 px-1.5 py-0.5 text-xs text-falcon-brown-900 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => actions.deleteAgendaItem(date, classSectionId, item.id)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-800/10"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const title = newTitle.trim();
          if (!title) return;
          actions.addAgendaItem(date, classSectionId, title);
          setNewTitle("");
        }}
        className="flex gap-2"
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New agenda item"
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
