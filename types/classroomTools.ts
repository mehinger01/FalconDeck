import type { ResourceType } from "./lesson";

/**
 * The Classroom Tool Tray's tools (Phase 4, Part 3). Purely a UI concept -
 * none of this is persisted; a tool's on-screen state (timer running,
 * Clean Screen active, a resource overlay showing) lives in Present
 * Mode's own React state and resets on reload, like a physical classroom
 * tool would.
 */
export const CLASSROOM_TOOL_KINDS = [
  "timer",
  "clean-screen",
  "quick-resource",
  "qr-code",
  "random-picker",
  "brain-break",
] as const;

export type ClassroomToolKind = (typeof CLASSROOM_TOOL_KINDS)[number];

export const CLASSROOM_TOOL_LABELS: Record<ClassroomToolKind, string> = {
  timer: "Timer",
  "clean-screen": "Clean Screen",
  "quick-resource": "Quick Resource",
  "qr-code": "QR Code",
  "random-picker": "Random Picker",
  "brain-break": "Brain Break",
};

/** What `ResourceOverlay` displays - a lesson resource, or a teacher-entered custom URL. */
export interface ResourceOverlayContent {
  title: string;
  url: string;
  /** Present for an actual lesson resource; absent for a custom URL. */
  type?: ResourceType;
}
