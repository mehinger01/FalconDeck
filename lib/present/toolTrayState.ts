import type { ClassroomToolKind, ResourceOverlayContent } from "@/types/classroomTools";

/**
 * Pure state machine for the Classroom Tool Tray - no React, and
 * critically, no `AppData`/`dispatch` of any kind. Every function here
 * only ever touches tray/overlay UI state, which is exactly what proves
 * (by construction, not just by convention) that opening or closing any
 * classroom tool can never mutate a lesson or the schedule: there is no
 * path from this module to the store. `usePresentModeTools` is the only
 * thing that wires this to `useState`.
 */
export interface ToolTrayState {
  trayExpanded: boolean;
  activeTool: ClassroomToolKind | null;
  cleanScreenActive: boolean;
  cleanScreenMessage: string;
  resourceOverlay: ResourceOverlayContent | null;
}

export function createToolTrayState(defaultCleanScreenMessage: string): ToolTrayState {
  return {
    trayExpanded: false,
    activeTool: null,
    cleanScreenActive: false,
    cleanScreenMessage: defaultCleanScreenMessage,
    resourceOverlay: null,
  };
}

export function toggleTray(state: ToolTrayState): ToolTrayState {
  return { ...state, trayExpanded: !state.trayExpanded };
}

export function closeTray(state: ToolTrayState): ToolTrayState {
  return { ...state, trayExpanded: false, activeTool: null };
}

export function selectTool(state: ToolTrayState, tool: ClassroomToolKind): ToolTrayState {
  return { ...state, activeTool: state.activeTool === tool ? null : tool };
}

export function startCleanScreen(state: ToolTrayState, message: string): ToolTrayState {
  return { ...closeTray(state), cleanScreenActive: true, cleanScreenMessage: message };
}

export function exitCleanScreen(state: ToolTrayState): ToolTrayState {
  return { ...state, cleanScreenActive: false };
}

export function showResource(state: ToolTrayState, content: ResourceOverlayContent): ToolTrayState {
  return { ...closeTray(state), resourceOverlay: content };
}

export function closeResourceOverlay(state: ToolTrayState): ToolTrayState {
  return { ...state, resourceOverlay: null };
}
