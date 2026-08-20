import type { ResourceType } from "./lesson";

export type LibraryResourceSource =
  | { kind: "manual" }
  | {
      kind: "google-drive";
      driveFileId: string;
      mimeType?: string;
      webViewUrl?: string;
    };

/**
 * A reusable resource in the teacher's library - the "source of truth" a
 * lesson resource can be attached from. Deliberately separate from
 * `LessonResource` (see that type's docs): attaching copies title/url/type
 * into the lesson as an independent snapshot, so editing or deleting a
 * LibraryResource never changes an already-attached lesson resource.
 */
export interface LibraryResource {
  id: string;
  title: string;
  url: string;
  type: ResourceType;
  /** Zero, one, or many courses - `[]` means "general", not tied to a specific course. */
  courseIds: string[];
  tags: string[];
  notes?: string;
  isFavorite: boolean;
  source: LibraryResourceSource;
  createdAt: string;
  updatedAt: string;
}
