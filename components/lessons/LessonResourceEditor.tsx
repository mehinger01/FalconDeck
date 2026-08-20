"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import { RESOURCE_TYPES } from "@/types/lesson";
import type { LessonResource, ResourceType } from "@/types/lesson";
import { ResourcePicker } from "@/components/resources/ResourcePicker";

export function LessonResourceEditor({
  date,
  classSectionId,
  resources,
}: {
  date: string;
  classSectionId: string;
  resources: LessonResource[];
}) {
  const { actions } = useAppData();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<ResourceType>("link");
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <section className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">Resources</h2>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-md border border-falcon-brown-700/30 px-2.5 py-1 text-xs font-semibold text-falcon-brown-800 hover:bg-falcon-gold-300/30"
        >
          Add from Library
        </button>
      </div>

      {resources.length === 0 ? (
        <p className="mb-3 text-sm text-falcon-brown-700/60">No resources yet. Add a link, doc, or slide deck below.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {resources.map((resource) => (
            <li
              key={resource.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-falcon-brown-700/15 bg-white p-2.5"
            >
              <input
                value={resource.title}
                onChange={(e) =>
                  actions.updateResource(date, classSectionId, resource.id, { title: e.target.value })
                }
                className="min-w-[8rem] flex-1 rounded-md border border-falcon-brown-700/20 bg-white px-2 py-1 text-sm font-medium text-falcon-brown-900"
              />
              <input
                value={resource.url}
                onChange={(e) =>
                  actions.updateResource(date, classSectionId, resource.id, { url: e.target.value })
                }
                className="min-w-[10rem] flex-[2] rounded-md border border-falcon-brown-700/20 bg-white px-2 py-1 text-xs text-falcon-brown-900"
              />
              <select
                value={resource.type}
                onChange={(e) =>
                  actions.updateResource(date, classSectionId, resource.id, {
                    type: e.target.value as ResourceType,
                  })
                }
                className="rounded-md border border-falcon-brown-700/20 bg-white px-2 py-1 text-xs text-falcon-brown-900"
              >
                {RESOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RESOURCE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => actions.deleteResource(date, classSectionId, resource.id)}
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
          const trimmedTitle = title.trim();
          const trimmedUrl = url.trim();
          if (!trimmedTitle || !trimmedUrl) return;
          actions.addResource(date, classSectionId, { title: trimmedTitle, url: trimmedUrl, type });
          setTitle("");
          setUrl("");
          setType("link");
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="min-w-[8rem] flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="min-w-[10rem] flex-[2] rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ResourceType)}
          className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
        >
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {RESOURCE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
        >
          + Add
        </button>
      </form>

      {pickerOpen && (
        <ResourcePicker
          onSelect={(resource) => {
            actions.addResource(date, classSectionId, {
              title: resource.title,
              url: resource.url,
              type: resource.type,
              libraryResourceId: resource.id,
            });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}
