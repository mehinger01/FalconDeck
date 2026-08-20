import type { ResourceType } from "@/types/lesson";

/**
 * Centralized Drive MIME type -> Falcon Deck `ResourceType` mapping (Part
 * 14) - the only place a MIME string should appear. Anything not
 * recognized falls back to "other" rather than throwing, since Drive can
 * return arbitrary file types.
 */
const GOOGLE_MIME_TYPE_MAP: Record<string, ResourceType> = {
  "application/vnd.google-apps.document": "document",
  "application/vnd.google-apps.presentation": "slides",
  "application/vnd.google-apps.spreadsheet": "spreadsheet",
  "application/pdf": "pdf",
};

export function mapMimeTypeToResourceType(mimeType: string | null | undefined): ResourceType {
  if (!mimeType) return "other";
  if (mimeType in GOOGLE_MIME_TYPE_MAP) return GOOGLE_MIME_TYPE_MAP[mimeType];
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "other";
}
