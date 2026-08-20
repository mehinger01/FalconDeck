import { findLibraryResource } from "@/lib/data/libraryResources";
import type { AppData } from "@/lib/data/types";
import type { LibraryResource } from "@/types/resource";
import type { DraftLibraryResource } from "@/lib/resources/googleDrive/convertExternalResource";
import { generateId } from "./id";
import type { AppDataAction } from "./actions";

type Dispatch = (action: AppDataAction) => void;

function nowIso(): string {
  return new Date().toISOString();
}

export interface LibraryResourceActions {
  createLibraryResource: (draft: DraftLibraryResource) => LibraryResource;
  updateLibraryResource: (
    resourceId: string,
    patch: Partial<Omit<LibraryResource, "id" | "createdAt" | "updatedAt">>,
  ) => void;
  deleteLibraryResource: (resourceId: string) => void;
  toggleLibraryResourceFavorite: (resourceId: string) => void;
  /** Copies an existing resource as a new, independent entry - handy for near-duplicate variants. */
  duplicateLibraryResource: (resourceId: string) => LibraryResource | null;
  /**
   * Imports (or, with `updateExistingId`, overwrites in place) an external
   * file already converted to a draft - see
   * `convertExternalResourceToLibraryResource`. The caller is responsible
   * for duplicate detection (`findLibraryResourceByDriveFileId`) and
   * getting explicit confirmation before passing `updateExistingId` (Part
   * 13: never silently overwrite).
   */
  importExternalResource: (draft: DraftLibraryResource, options?: { updateExistingId?: string }) => LibraryResource;
}

/**
 * Builds the Resource Library slice of `AppDataActions` - mirrors
 * `createLessonActions`'s shape (find-or-build the next value, dispatch a
 * single upsert). Entirely separate from lesson mutations: nothing here
 * ever touches `data.lessons`, matching Part 20 (deleting a library
 * resource must never cascade into lessons that already attached it).
 */
export function createLibraryResourceActions(data: AppData, dispatch: Dispatch): LibraryResourceActions {
  function upsert(resource: LibraryResource) {
    dispatch({ type: "UPSERT_LIBRARY_RESOURCE", resource });
    return resource;
  }

  return {
    createLibraryResource(draft) {
      const timestamp = nowIso();
      return upsert({ id: generateId("library-resource"), ...draft, createdAt: timestamp, updatedAt: timestamp });
    },

    updateLibraryResource(resourceId, patch) {
      const existing = findLibraryResource(data.libraryResources, resourceId);
      if (!existing) return;
      upsert({ ...existing, ...patch, updatedAt: nowIso() });
    },

    deleteLibraryResource(resourceId) {
      dispatch({ type: "DELETE_LIBRARY_RESOURCE", resourceId });
    },

    toggleLibraryResourceFavorite(resourceId) {
      const existing = findLibraryResource(data.libraryResources, resourceId);
      if (!existing) return;
      upsert({ ...existing, isFavorite: !existing.isFavorite, updatedAt: nowIso() });
    },

    duplicateLibraryResource(resourceId) {
      const existing = findLibraryResource(data.libraryResources, resourceId);
      if (!existing) return null;
      const timestamp = nowIso();
      return upsert({
        ...existing,
        id: generateId("library-resource"),
        title: `${existing.title} (Copy)`,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },

    importExternalResource(draft, options) {
      const timestamp = nowIso();
      const existing = options?.updateExistingId
        ? findLibraryResource(data.libraryResources, options.updateExistingId)
        : null;
      return upsert({
        id: existing?.id ?? generateId("library-resource"),
        ...draft,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
    },
  };
}
