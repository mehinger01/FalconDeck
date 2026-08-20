"use client";

import { useState } from "react";
import type { ClassroomToolKind } from "@/types/classroomTools";
import {
  closeResourceOverlay,
  closeTray,
  createToolTrayState,
  exitCleanScreen,
  selectTool,
  showResource,
  startCleanScreen,
  toggleTray,
  type ToolTrayState,
} from "@/lib/present/toolTrayState";
import type { ResourceOverlayContent } from "./ResourceOverlay";

/**
 * Thin React wrapper around `toolTrayState` (pure logic, no React, no
 * store access - see that module for why activating/dismissing a tool can
 * never mutate a lesson or the schedule). Kept out of `PresentScreen`
 * itself so it stays a thin orchestrator rather than owning this state
 * directly (Part 13's "avoid a giant conditional component").
 */
export function usePresentModeTools(defaultCleanScreenMessage: string) {
  const [state, setState] = useState<ToolTrayState>(() => createToolTrayState(defaultCleanScreenMessage));

  return {
    ...state,
    toggleTray: () => setState(toggleTray),
    closeTray: () => setState(closeTray),
    selectTool: (tool: ClassroomToolKind) => setState((current) => selectTool(current, tool)),
    startCleanScreen: (message: string) => setState((current) => startCleanScreen(current, message)),
    exitCleanScreen: () => setState(exitCleanScreen),
    showResource: (content: ResourceOverlayContent) => setState((current) => showResource(current, content)),
    closeResourceOverlay: () => setState(closeResourceOverlay),
  };
}

export type PresentModeTools = ReturnType<typeof usePresentModeTools>;
