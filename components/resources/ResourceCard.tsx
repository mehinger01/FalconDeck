"use client";

import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import type { Course } from "@/types/course";
import type { LibraryResource } from "@/types/resource";

/**
 * One reusable compact resource row/card - used both by the main Resource
 * Library screen (full management actions) and by `ResourcePicker` (just
 * "Add"), so there is exactly one way a resource renders (Principle 7: no
 * duplicate competing resource systems). Every action is optional; only
 * the buttons a caller actually wires up appear.
 */
export function ResourceCard({
  resource,
  courses,
  onAdd,
  onEdit,
  onDelete,
  onToggleFavorite,
  onDuplicate,
  selected = false,
}: {
  resource: LibraryResource;
  courses: Course[];
  onAdd?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleFavorite?: () => void;
  onDuplicate?: () => void;
  selected?: boolean;
}) {
  const courseNames = resource.courseIds
    .map((id) => courses.find((course) => course.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 ${
        selected ? "border-falcon-gold-500 bg-falcon-gold-300/15" : "border-falcon-brown-700/15 bg-white/60"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-falcon-brown-900">{resource.title}</p>
          <p className="truncate text-xs text-falcon-brown-700/60">
            {RESOURCE_TYPE_LABELS[resource.type]}
            {courseNames.length > 0 ? ` · ${courseNames.join(", ")}` : " · General"}
            {resource.source.kind === "google-drive" ? " · Drive" : ""}
          </p>
        </div>
        {onToggleFavorite && (
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-label={resource.isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={resource.isFavorite}
            className={`shrink-0 text-lg leading-none ${
              resource.isFavorite ? "text-falcon-gold-500" : "text-falcon-brown-700/25 hover:text-falcon-gold-500"
            }`}
          >
            ★
          </button>
        )}
      </div>

      {resource.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {resource.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-falcon-gold-300/30 px-2 py-0.5 text-[10px] font-semibold text-falcon-brown-800"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-falcon-brown-700/30 px-2 py-1 text-falcon-brown-900 hover:bg-falcon-gold-300/30"
        >
          Open
        </a>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="rounded-md bg-falcon-brown-900 px-2 py-1 text-falcon-cream-100 hover:bg-falcon-brown-800"
          >
            + Add
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-falcon-brown-700/30 px-2 py-1 text-falcon-brown-900 hover:bg-falcon-gold-300/30"
          >
            Edit
          </button>
        )}
        {onDuplicate && (
          <button
            type="button"
            onClick={onDuplicate}
            className="rounded-md border border-falcon-brown-700/30 px-2 py-1 text-falcon-brown-900 hover:bg-falcon-gold-300/30"
          >
            Duplicate
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete} className="rounded-md px-2 py-1 text-red-800 hover:bg-red-800/10">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
