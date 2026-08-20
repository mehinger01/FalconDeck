"use client";

import type { DailyLesson } from "@/types/lesson";
import { CLASSROOM_TOOL_KINDS, CLASSROOM_TOOL_LABELS } from "@/types/classroomTools";
import type { ClassroomTimer } from "@/lib/tools/timer/useClassroomTimer";
import type { PresentModeTools } from "./usePresentModeTools";
import { TimerPanel } from "./TimerPanel";
import { CleanScreenPanel } from "./CleanScreenPanel";
import { QuickResourcePanel } from "./QuickResourcePanel";
import { QrCodePanel } from "./QrCodePanel";
import { RandomPickerPanel } from "./RandomPickerPanel";
import { BrainBreakPanel } from "./BrainBreakPanel";

/**
 * The teacher-only Classroom Tool Tray: collapsed by default so the
 * student-facing screen never looks like a dashboard. Expanding it reveals
 * the six tools; selecting one reveals just that tool's small control
 * panel inline, never a second layer of navigation.
 */
export function ToolTray({
  tools,
  timer,
  currentLesson,
}: {
  tools: PresentModeTools;
  timer: ClassroomTimer;
  currentLesson: DailyLesson | null;
}) {
  if (!tools.trayExpanded) {
    return (
      <button
        type="button"
        onClick={tools.toggleTray}
        aria-label="Open classroom tools"
        className="fixed right-4 top-4 z-20 text-xs text-falcon-cream-200/20 transition-colors hover:text-falcon-cream-200/60"
      >
        Tools
      </button>
    );
  }

  return (
    <div className="animate-present-fade fixed right-4 top-4 z-20 flex w-72 flex-col gap-3 rounded-lg border border-falcon-cream-200/10 bg-falcon-brown-950/95 p-3 text-xs shadow-xl">
      <div className="flex items-center justify-between">
        <p className="font-bold uppercase tracking-wide text-falcon-cream-200/50">Classroom Tools</p>
        <button
          type="button"
          onClick={tools.closeTray}
          aria-label="Collapse classroom tools"
          className="text-falcon-cream-200/40 hover:text-falcon-cream-200/80"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {CLASSROOM_TOOL_KINDS.map((tool) => (
          <button
            key={tool}
            type="button"
            onClick={() => tools.selectTool(tool)}
            aria-pressed={tools.activeTool === tool}
            className={`rounded-md border px-2 py-1.5 text-center font-semibold ${
              tools.activeTool === tool
                ? "border-falcon-gold-400 bg-falcon-gold-400 text-falcon-brown-950"
                : "border-falcon-cream-200/20 text-falcon-cream-100 hover:bg-falcon-cream-200/10"
            }`}
          >
            {CLASSROOM_TOOL_LABELS[tool]}
          </button>
        ))}
      </div>

      {tools.activeTool && (
        <div className="border-t border-falcon-cream-200/10 pt-3">
          {tools.activeTool === "timer" && <TimerPanel timer={timer} />}
          {tools.activeTool === "clean-screen" && (
            <CleanScreenPanel defaultMessage={tools.cleanScreenMessage} onStart={tools.startCleanScreen} />
          )}
          {tools.activeTool === "quick-resource" && (
            <QuickResourcePanel
              lesson={currentLesson}
              onSelect={(resource) =>
                tools.showResource({ title: resource.title, url: resource.url, type: resource.type })
              }
            />
          )}
          {tools.activeTool === "qr-code" && (
            <QrCodePanel lesson={currentLesson} onGenerate={tools.showResource} />
          )}
          {tools.activeTool === "random-picker" && <RandomPickerPanel />}
          {tools.activeTool === "brain-break" && <BrainBreakPanel />}
        </div>
      )}
    </div>
  );
}
