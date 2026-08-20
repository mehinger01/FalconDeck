import type { LibraryResource } from "@/types/resource";

export function findLibraryResource(resources: LibraryResource[], id: string): LibraryResource | null {
  return resources.find((resource) => resource.id === id) ?? null;
}

/** Used for Drive-import duplicate detection (Part 13) - never for manual resources. */
export function findLibraryResourceByDriveFileId(
  resources: LibraryResource[],
  driveFileId: string,
): LibraryResource | null {
  return (
    resources.find((resource) => resource.source.kind === "google-drive" && resource.source.driveFileId === driveFileId) ??
    null
  );
}
