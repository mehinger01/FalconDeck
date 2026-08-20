"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { filterResources } from "@/lib/resources/filterResources";
import type { ResourceType } from "@/types/lesson";
import type { LibraryResource } from "@/types/resource";
import { DriveImportPanel } from "./DriveImportPanel";
import { ResourceCard } from "./ResourceCard";
import { ResourceFilters } from "./ResourceFilters";
import { ResourceFormModal } from "./ResourceFormModal";

/**
 * The teacher's resource cabinet, not a file manager (product goal): a
 * prominent search bar, progressively-disclosed filters, and compact
 * cards - no dense admin table. All search/filter logic lives in
 * `filterResources`, shared with `ResourcePicker` so there's exactly one
 * implementation.
 */
export function ResourceLibraryScreen() {
  const { data, actions } = useAppData();
  const [query, setQuery] = useState("");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [type, setType] = useState<ResourceType | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editingResource, setEditingResource] = useState<LibraryResource | null>(null);
  const [creating, setCreating] = useState(false);
  const [driveExpanded, setDriveExpanded] = useState(false);

  const filtered = filterResources(
    data.libraryResources,
    query,
    { courseId, type, favoritesOnly },
    data.courses,
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-falcon-brown-900">Resources</h1>
          <p className="mt-1 text-sm text-falcon-brown-700/70">
            Save a resource once, then attach it to any lesson in seconds.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDriveExpanded((current) => !current)}
            className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-800 hover:bg-falcon-gold-300/30"
          >
            {driveExpanded ? "Hide Drive Import" : "Import from Google Drive"}
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
          >
            + Add Resource
          </button>
        </div>
      </div>

      {driveExpanded && (
        <div className="mb-6">
          <DriveImportPanel />
        </div>
      )}

      <div className="mb-4">
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
      </div>

      {data.libraryResources.length === 0 ? (
        <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-6 text-center text-sm text-falcon-brown-700/60">
          Save links, files, and activities here so you can reuse them across lessons.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-6 text-center text-sm text-falcon-brown-700/60">
          No resources match this search.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              courses={data.courses}
              onEdit={() => setEditingResource(resource)}
              onDelete={() => {
                if (
                  window.confirm(
                    `Delete "${resource.title}"? Lessons that already attached it keep their own copy.`,
                  )
                ) {
                  actions.deleteLibraryResource(resource.id);
                }
              }}
              onToggleFavorite={() => actions.toggleLibraryResourceFavorite(resource.id)}
              onDuplicate={() => actions.duplicateLibraryResource(resource.id)}
            />
          ))}
        </div>
      )}

      {(creating || editingResource) && (
        <ResourceFormModal
          resource={editingResource}
          onClose={() => {
            setCreating(false);
            setEditingResource(null);
          }}
        />
      )}
    </div>
  );
}
