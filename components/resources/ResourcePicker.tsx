"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { filterResources } from "@/lib/resources/filterResources";
import type { ResourceType } from "@/types/lesson";
import type { LibraryResource } from "@/types/resource";
import { ResourceCard } from "./ResourceCard";
import { ResourceFilters } from "./ResourceFilters";

/**
 * A reusable compact picker (Part 15) - used from the Lesson editor (and
 * optionally Week) so a teacher never has to leave the page they're on
 * just to attach a known resource. Auto-focused search, one-click Add,
 * close - no navigation to /resources required.
 */
export function ResourcePicker({
  onSelect,
  onClose,
}: {
  onSelect: (resource: LibraryResource) => void;
  onClose: () => void;
}) {
  const { data } = useAppData();
  const [query, setQuery] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [type, setType] = useState<ResourceType | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const filtered = filterResources(
    data.libraryResources,
    query,
    { courseId, type, favoritesOnly },
    data.courses,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-falcon-brown-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-falcon-cream-100 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-falcon-brown-900">Add from Resource Library</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-falcon-brown-700/60 hover:bg-falcon-brown-700/10"
          >
            ✕
          </button>
        </div>

        <ResourceFilters
          query={query}
          onQueryChange={setQuery}
          courseId={courseId}
          onCourseIdChange={setCourseId}
          type={type}
          onTypeChange={setType}
          favoritesOnly={favoritesOnly}
          onFavoritesOnlyChange={setFavoritesOnly}
          courses={data.courses}
          autoFocusSearch
        />

        <div className="mt-3 flex-1 overflow-y-auto">
          {data.libraryResources.length === 0 ? (
            <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-4 text-center text-sm text-falcon-brown-700/60">
              No resources saved yet - add one from the Resources screen first.
            </p>
          ) : filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-4 text-center text-sm text-falcon-brown-700/60">
              No resources match this search.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  courses={data.courses}
                  onAdd={() => onSelect(resource)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
