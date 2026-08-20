"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { getLocalDateKey, weekdayForDateKey } from "@/lib/schedule/localDate";
import { resolveScheduleForWeekday } from "@/lib/schedule/resolveBlockOverride";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import { useClassroomTimer } from "@/lib/tools/timer/useClassroomTimer";
import type { DailyLesson } from "@/types/lesson";
import { LivePresentScreen } from "./LivePresentScreen";
import { PresentModeControls, type PresentMode } from "./PresentModeControls";
import { PreviewPresentScreen } from "./PreviewPresentScreen";
import { CleanScreenOverlay } from "./tools/CleanScreenOverlay";
import { ResourceOverlay } from "./tools/ResourceOverlay";
import { TimerWidget } from "./tools/TimerWidget";
import { ToolTray } from "./tools/ToolTray";
import { usePresentModeTools } from "./tools/usePresentModeTools";

/**
 * Routes between Live Mode (`LivePresentScreen`, the schedule-driven
 * presentation) and Preview Mode (`PreviewPresentScreen`, an arbitrary
 * date/section chosen by the teacher). Mode and Preview's selections live
 * in the URL query string so a preview can be bookmarked or refreshed;
 * Live Mode is the default with no query string at all.
 *
 * Also hosts the Classroom Tool Tray and its overlays (Part 3-7). These
 * are pure UI state (`usePresentModeTools`, `useClassroomTimer`) layered
 * on top of whichever mode is rendering underneath - none of it reads or
 * writes schedule or lesson state, so activating/dismissing a tool can
 * never affect what Live/Preview shows once the tool is dismissed.
 */
export function PresentScreen() {
  const searchParams = useSearchParams();
  const { data } = useAppData();
  const schedule = useDefaultSchedule();
  const timeZone = schedule?.timeZone ?? DEFAULT_TIME_ZONE;
  const settings = data.classroomExperienceSettings;

  const mode: PresentMode = searchParams.get("mode") === "preview" ? "preview" : "live";
  const date = searchParams.get("date") ?? getLocalDateKey(new Date(), timeZone);
  const classSectionId = searchParams.get("section") ?? data.classSections[0]?.id ?? null;
  const blockIdParam = searchParams.get("block");

  // Real schedule context for Preview's optional period label - reuses the
  // same override-resolution the live engine uses, never re-implements it.
  const blockOptions =
    schedule && classSectionId
      ? resolveScheduleForWeekday(schedule, weekdayForDateKey(date)).filter(
          (block) => block.classSectionId === classSectionId,
        )
      : [];
  const selectedBlock = blockOptions.find((block) => block.id === blockIdParam) ?? blockOptions[0] ?? null;

  const [currentLesson, setCurrentLesson] = useState<DailyLesson | null>(null);
  const timer = useClassroomTimer();
  const tools = usePresentModeTools(settings.cleanScreenDefaultMessage);

  return (
    <div className="relative min-h-screen">
      {mode === "live" ? (
        <LivePresentScreen onCurrentLessonChange={setCurrentLesson} />
      ) : (
        <PreviewPresentScreen
          date={date}
          classSectionId={classSectionId}
          block={selectedBlock}
          onCurrentLessonChange={setCurrentLesson}
        />
      )}

      <PresentModeControls
        mode={mode}
        date={date}
        classSectionId={classSectionId}
        blockId={selectedBlock?.id ?? null}
        blockOptions={blockOptions}
      />

      <ToolTray tools={tools} timer={timer} currentLesson={currentLesson} />
      <TimerWidget timer={timer} />

      {tools.cleanScreenActive && (
        <CleanScreenOverlay
          message={tools.cleanScreenMessage}
          timeZone={timeZone}
          showClock={settings.showClockOnCleanScreen}
          timer={timer}
          onExit={tools.exitCleanScreen}
        />
      )}

      {tools.resourceOverlay && (
        <ResourceOverlay content={tools.resourceOverlay} onClose={tools.closeResourceOverlay} />
      )}
    </div>
  );
}
