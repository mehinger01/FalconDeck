import type { ExternalResource } from "@/lib/resources/externalResourceProvider";
import type { LibraryResource } from "@/types/resource";
import { mapMimeTypeToResourceType } from "./mimeTypeMapping";

export type DraftLibraryResource = Omit<LibraryResource, "id" | "createdAt" | "updatedAt">;

/**
 * `ExternalResource` -> a draft `LibraryResource` ready to save (Part 10).
 * The store action fills in id/createdAt/updatedAt, same as every other
 * "create" action in this app - this function only decides what content
 * an imported Drive file becomes.
 */
export function convertExternalResourceToLibraryResource(
  external: ExternalResource,
  overrides?: { courseIds?: string[]; tags?: string[]; notes?: string },
): DraftLibraryResource {
  return {
    title: external.name,
    url: external.webViewUrl,
    type: mapMimeTypeToResourceType(external.mimeType),
    courseIds: overrides?.courseIds ?? [],
    tags: overrides?.tags ?? [],
    notes: overrides?.notes,
    isFavorite: false,
    source: {
      kind: "google-drive",
      driveFileId: external.id,
      mimeType: external.mimeType,
      webViewUrl: external.webViewUrl,
    },
  };
}
