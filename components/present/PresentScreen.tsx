"use client";

import { useSearchParams } from "next/navigation";
import { useAppData, useDefaultSchedule } from "@/lib/store/AppDataProvider";
import { getLocalDateKey, weekdayForDateKey } from "@/lib/schedule/localDate";
import { resolveScheduleForWeekday } from "@/lib/schedule/resolveBlockOverride";
import { DEFAULT_TIME_ZONE } from "@/lib/schedule/time";
import { LivePresentScreen } from "./LivePresentScreen";
import { PresentModeControls, type PresentMode } from "./PresentModeControls";
import { PreviewPresentScreen } from "./PreviewPresentScreen";

/**
 * Routes between Live Mode (`LivePresentScreen`, the unmodified Phase 1/2
 * schedule-driven presentation) and Preview Mode (`PreviewPresentScreen`,
 * Phase 2.5 - an arbitrary date/section chosen by the teacher, useful
 * outside the live school day). Mode and Preview's selections live in the
 * URL query string (`?mode=preview&date=...&section=...&block=...`) so a
 * preview can be bookmarked or refreshed; Live Mode is the default with no
 * query string at all.
 */
export function PresentScreen() {
  const searchParams = useSearchParams();
  const { data } = useAppData();
  const schedule = useDefaultSchedule();
  const timeZone = schedule?.timeZone ?? DEFAULT_TIME_ZONE;

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

  return (
    <div className="relative min-h-screen">
      {mode === "live" ? (
        <LivePresentScreen />
      ) : (
        <PreviewPresentScreen date={date} classSectionId={classSectionId} block={selectedBlock} />
      )}

      <PresentModeControls
        mode={mode}
        date={date}
        classSectionId={classSectionId}
        blockId={selectedBlock?.id ?? null}
        blockOptions={blockOptions}
      />
    </div>
  );
}
