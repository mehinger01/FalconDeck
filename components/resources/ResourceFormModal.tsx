"use client";

import { useState, type FormEvent } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import { inferResourceType } from "@/lib/resources/inferResourceType";
import { RESOURCE_TYPES } from "@/types/lesson";
import type { ResourceType } from "@/types/lesson";
import type { LibraryResource } from "@/types/resource";
import { TagInput } from "./TagInput";

/**
 * Create or edit a LibraryResource. `resource: null` means "create new".
 * URL type is inferred from the pasted URL but always stays a plain
 * override-able dropdown (Part 4) - never a hard classification.
 */
export function ResourceFormModal({
  resource,
  onClose,
}: {
  resource: LibraryResource | null;
  onClose: () => void;
}) {
  const { data, actions } = useAppData();
  const [title, setTitle] = useState(resource?.title ?? "");
  const [url, setUrl] = useState(resource?.url ?? "");
  const [type, setType] = useState<ResourceType>(resource?.type ?? "link");
  const [typeManuallySet, setTypeManuallySet] = useState(Boolean(resource));
  const [courseIds, setCourseIds] = useState<string[]>(resource?.courseIds ?? []);
  const [tags, setTags] = useState<string[]>(resource?.tags ?? []);
  const [notes, setNotes] = useState(resource?.notes ?? "");

  function handleUrlChange(value: string) {
    setUrl(value);
    if (!typeManuallySet) setType(inferResourceType(value));
  }

  function toggleCourse(courseId: string) {
    setCourseIds((current) =>
      current.includes(courseId) ? current.filter((id) => id !== courseId) : [...current, courseId],
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedUrl = url.trim();
    if (!trimmedTitle || !trimmedUrl) return;

    const draft = {
      title: trimmedTitle,
      url: trimmedUrl,
      type,
      courseIds,
      tags,
      notes: notes.trim() || undefined,
    };

    if (resource) {
      actions.updateLibraryResource(resource.id, draft);
    } else {
      actions.createLibraryResource({ ...draft, isFavorite: false, source: { kind: "manual" } });
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-falcon-brown-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-falcon-cream-100 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-falcon-brown-900">{resource ? "Edit Resource" : "Add Resource"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-falcon-brown-700/60 hover:bg-falcon-brown-700/10"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">URL</span>
            <input
              value={url}
              onChange={(event) => handleUrlChange(event.target.value)}
              type="url"
              required
              placeholder="https://…"
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Type</span>
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value as ResourceType);
                setTypeManuallySet(true);
              }}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            >
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RESOURCE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Courses (optional)</span>
            <div className="flex flex-wrap gap-1.5">
              {data.courses.length === 0 && <p className="text-xs text-falcon-brown-700/60">No courses yet.</p>}
              {data.courses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => toggleCourse(course.id)}
                  aria-pressed={courseIds.includes(course.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    courseIds.includes(course.id)
                      ? "border-falcon-gold-500 bg-falcon-gold-400 text-falcon-brown-950"
                      : "border-falcon-brown-700/30 text-falcon-brown-800 hover:bg-falcon-gold-300/30"
                  }`}
                >
                  {course.name}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Tags</span>
            <TagInput tags={tags} onChange={setTags} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-falcon-brown-700 hover:bg-falcon-brown-700/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
            >
              {resource ? "Save Changes" : "Add Resource"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
