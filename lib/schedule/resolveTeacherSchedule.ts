import type { BellSchedule, ScheduleBlock } from "@/types/schedule";
import type { LunchWave, TeacherSchedulePreferences } from "@/types/teacherSchedule";
import { secondsToTimeString, timeStringToSeconds } from "./time";

const LUNCH_WAVE_INDEX: Record<Exclude<LunchWave, "none">, number> = { A: 0, B: 1, C: 2 };

/**
 * Splits a schedule's `isLunchWindow` block into up to three equal-thirds
 * sub-blocks - pre-lunch instructional time, the teacher's chosen 30-minute
 * lunch wave, and post-lunch instructional time - implementing the A/B/C
 * lunch-rotation model this task specifies. Never mutates `baseSchedule`;
 * always returns a new BellSchedule (or `baseSchedule` itself, unchanged,
 * when there's nothing to split).
 *
 * The pre/post segments keep the original block's `classSectionId`, so the
 * same DailyLesson lookup (by date + classSectionId) resumes automatically
 * after lunch - there is deliberately no separate "post-lunch lesson"
 * concept anywhere in the domain model.
 */
export function resolveTeacherSchedule(
  baseSchedule: BellSchedule,
  preferences: TeacherSchedulePreferences,
): BellSchedule {
  if (preferences.lunchWave === "none") return baseSchedule;

  const lunchBlockIndex = baseSchedule.blocks.findIndex((b) => b.isLunchWindow);
  if (lunchBlockIndex === -1) return baseSchedule;

  const lunchBlock = baseSchedule.blocks[lunchBlockIndex];
  const subBlocks = splitLunchWindowBlock(lunchBlock, preferences.lunchWave);

  const blocks = [...baseSchedule.blocks];
  blocks.splice(lunchBlockIndex, 1, ...subBlocks);

  return { ...baseSchedule, blocks };
}

function splitLunchWindowBlock(sourceBlock: ScheduleBlock, wave: Exclude<LunchWave, "none">): ScheduleBlock[] {
  const startSeconds = timeStringToSeconds(sourceBlock.startTime);
  const endSeconds = timeStringToSeconds(sourceBlock.endTime);
  const totalSeconds = endSeconds - startSeconds;
  const waveSeconds = totalSeconds / 3;

  const waveIndex = LUNCH_WAVE_INDEX[wave];
  const lunchStart = startSeconds + waveIndex * waveSeconds;
  const lunchEnd = lunchStart + waveSeconds;

  const segments: Array<{ start: number; end: number; isLunch: boolean }> = [];
  if (lunchStart > startSeconds) segments.push({ start: startSeconds, end: lunchStart, isLunch: false });
  segments.push({ start: lunchStart, end: lunchEnd, isLunch: true });
  if (lunchEnd < endSeconds) segments.push({ start: lunchEnd, end: endSeconds, isLunch: false });

  return segments.map((segment, index) => ({
    id: `${sourceBlock.id}--${wave.toLowerCase()}-${index}`,
    label: segment.isLunch ? "Lunch" : sourceBlock.label,
    kind: segment.isLunch ? "lunch" : sourceBlock.kind,
    customKindLabel: segment.isLunch ? undefined : sourceBlock.customKindLabel,
    startTime: secondsToTimeString(segment.start),
    endTime: secondsToTimeString(segment.end),
    classSectionId: segment.isLunch ? null : sourceBlock.classSectionId,
    overrides: [],
  }));
}
