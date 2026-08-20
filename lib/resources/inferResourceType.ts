import type { ResourceType } from "@/types/lesson";

/**
 * A light heuristic from a pasted URL to a likely `ResourceType`, so the
 * manual-add form can pre-select something sensible - always overridable
 * by the teacher (Part 4: "do not try to classify every URL perfectly").
 */
export function inferResourceType(url: string): ResourceType {
  const value = url.trim().toLowerCase();
  if (!value) return "link";

  if (value.includes("docs.google.com/document")) return "document";
  if (value.includes("docs.google.com/presentation")) return "slides";
  if (value.includes("docs.google.com/spreadsheets")) return "spreadsheet";
  if (value.includes("desmos.com")) return "desmos";
  if (/\.pdf(\?.*)?$/.test(value)) return "pdf";
  if (value.includes("youtube.com") || value.includes("youtu.be") || value.includes("vimeo.com")) return "video";
  if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/.test(value)) return "image";
  if (value.includes("drive.google.com")) return "document";

  return "link";
}
