"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { useSimulatedNow } from "@/lib/hooks/useSimulatedNow";
import { useClassroomTimer } from "@/lib/tools/timer/useClassroomTimer";
import { resolveTeacherSchedule } from "@/lib/schedule/resolveTeacherSchedule";
import { secondsToTimeString, timeStringToSeconds } from "@/lib/schedule/time";
import type { LunchWave } from "@/types/teacherSchedule";
import { LUNCH_WAVE_LABELS } from "@/types/teacherSchedule";
import { LivePresentScreen } from "@/components/present/LivePresentScreen";
import { CleanScreenOverlay } from "@/components/present/tools/CleanScreenOverlay";
import { ResourceOverlay } from "@/components/present/tools/ResourceOverlay";
import { TimerWidget } from "@/components/present/tools/TimerWidget";
import { ToolTray } from "@/components/present/tools/ToolTray";
import { usePresentModeTools } from "@/components/present/tools/usePresentModeTools";
import type { DailyLesson } from "@/types/lesson";

const LUNCH_WAVES: LunchWave[] = ["A", "B", "C", "none"];

interface DynamicScenario {
  id: string;
  label: string;
  description: string;
  date: Date;
}

function atDemoTime(dateKey: string, seconds: number): Date {
  const time = secondsToTimeString(Math.max(0, Math.min(seconds, 23 * 3600 + 59 * 60 + 59)));
  return new Date(`${dateKey}T${time}-04:00`);
}

export function DemoPresentSimulator() {
  const { data, actions } = useAppData();
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [currentLesson, setCurrentLesson] = useState<DailyLesson | null>(null);

  const defaultSchedule = data.schedules.find((s) => s.isDefault) ?? data.schedules[0] ?? null;
  const regularDate = data.schoolCalendar?.firstStudentDay ?? "2026-08-31";

  const scenarios = useMemo<DynamicScenario[]>(() => {
    if (!defaultSchedule) return [];

    const resolved = resolveTeacherSchedule(defaultSchedule, data.teacherSchedulePreferences);
    const blocks = [...resolved.blocks].sort(
      (a, b) => timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime),
    );
    const teaching = blocks.filter(
      (block) => (block.kind === "instructional" || block.kind === "enrichment") && block.classSectionId,
    );
    const firstTeaching = teaching[0];
    const fifthTeaching = teaching[4];
    const sixthTeaching = teaching[5];
    const firstPassing = blocks.find((block) => block.kind === "passing");
    const lunch = blocks.find((block) => block.kind === "lunch");
    const lastBlock = blocks[blocks.length - 1];

    const next: DynamicScenario[] = [];

    if (firstTeaching) {
      const start = timeStringToSeconds(firstTeaching.startTime);
      const end = timeStringToSeconds(firstTeaching.endTime);
      next.push({
        id: "start-first",
        label: `Start ${firstTeaching.label}`,
        description: `Jump to the beginning of ${firstTeaching.label}`,
        date: atDemoTime(regularDate, start + 60),
      });
      next.push({
        id: "mid-class",
        label: "Mid-Class",
        description: `Jump to the middle of ${firstTeaching.label}`,
        date: atDemoTime(regularDate, Math.floor((start + end) / 2)),
      });
      next.push({
        id: "final-thirty",
        label: "Final 30 Seconds",
        description: `Jump to 30 seconds before ${firstTeaching.label} ends`,
        date: atDemoTime(regularDate, end - 30),
      });
    }

    if (firstPassing) {
      const start = timeStringToSeconds(firstPassing.startTime);
      const end = timeStringToSeconds(firstPassing.endTime);
      next.push({
        id: "passing",
        label: "Passing",
        description: "Jump into a real passing block from the current schedule",
        date: atDemoTime(regularDate, Math.floor((start + end) / 2)),
      });
    }

    if (lunch) {
      next.push({
        id: "lunch",
        label: `${data.teacherSchedulePreferences.lunchWave} Lunch`,
        description: "Jump into the lunch wave resolved from your current lunch preference",
        date: atDemoTime(regularDate, timeStringToSeconds(lunch.startTime) + 60),
      });
    }

    if (fifthTeaching) {
      next.push({
        id: "start-fifth",
        label: `Start ${fifthTeaching.label}`,
        description: `Jump to the instructional portion of ${fifthTeaching.label}`,
        date: atDemoTime(regularDate, timeStringToSeconds(fifthTeaching.startTime) + 60),
      });
    }

    if (sixthTeaching) {
      next.push({
        id: "start-sixth",
        label: `Start ${sixthTeaching.label}`,
        description: `Jump to the beginning of ${sixthTeaching.label}`,
        date: atDemoTime(regularDate, timeStringToSeconds(sixthTeaching.startTime) + 60),
      });
    }

    if (lastBlock) {
      next.push({
        id: "end-of-day",
        label: "End of Day",
        description: "Jump to five minutes after the final scheduled block",
        date: atDemoTime(regularDate, timeStringToSeconds(lastBlock.endTime) + 5 * 60),
      });
    }

    const special = data.schoolCalendar?.exceptions.find((e) => e.type === "special-bell");
    if (special) {
      next.push({
        id: "special-bell",
        label: "Special Bell",
        description: special.title,
        date: atDemoTime(special.startDate, 8 * 3600 + 30 * 60),
      });
    }

    const noSchool = data.schoolCalendar?.exceptions.find((e) => e.type === "no-school");
    if (noSchool) {
      next.push({
        id: "no-school",
        label: "No School",
        description: noSchool.title,
        date: atDemoTime(noSchool.startDate, 9 * 3600),
      });
    }

    const noStudents = data.schoolCalendar?.exceptions.find((e) => e.type === "no-students");
    if (noStudents) {
      next.push({
        id: "no-students",
        label: "No Students",
        description: noStudents.title,
        date: atDemoTime(noStudents.startDate, 9 * 3600),
      });
    }

    return next;
  }, [data.schoolCalendar, data.teacherSchedulePreferences, defaultSchedule, regularDate]);

  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null;
  const simulatedNow = useSimulatedNow(scenario?.date ?? null);

  const timer = useClassroomTimer();
  const tools = usePresentModeTools(data.classroomExperienceSettings.cleanScreenDefaultMessage);
  const timeZone = data.schoolCalendar?.timeZone ?? "America/Detroit";

  return (
    <div className="relative min-h-screen">
      {scenario && simulatedNow ? (
        <LivePresentScreen overrideNow={simulatedNow} onCurrentLessonChange={setCurrentLesson} />
      ) : (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-falcon-brown-950 px-10 text-center text-falcon-cream-100">
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-falcon-gold-400">Demo Present Simulator</p>
          <h1 className="text-4xl font-black">Choose a jump point below</h1>
          <p className="max-w-xl text-sm text-falcon-cream-200/60">
            These controls are generated from your saved default schedule and feed a simulated clock into Falcon Deck&rsquo;s real Present engine.
          </p>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
        <div className="pointer-events-auto flex max-w-5xl flex-wrap items-center justify-center gap-2 rounded-xl border border-falcon-cream-200/10 bg-falcon-brown-950/95 p-3 shadow-2xl">
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScenarioId(s.id)}
              title={s.description}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                scenarioId === s.id
                  ? "bg-falcon-gold-400 text-falcon-brown-950"
                  : "bg-falcon-cream-200/10 text-falcon-cream-100 hover:bg-falcon-cream-200/20"
              }`}
            >
              {s.label}
            </button>
          ))}

          <div className="ml-2 flex items-center gap-1 border-l border-falcon-cream-200/20 pl-2">
            <span className="text-xs font-semibold text-falcon-cream-200/60">My Lunch:</span>
            {LUNCH_WAVES.map((wave) => (
              <button
                key={wave}
                type="button"
                onClick={() => {
                  actions.updateTeacherSchedulePreferences({ lunchWave: wave });
                  setScenarioId(null);
                }}
                className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                  data.teacherSchedulePreferences.lunchWave === wave
                    ? "bg-falcon-gold-400 text-falcon-brown-950"
                    : "bg-falcon-cream-200/10 text-falcon-cream-100 hover:bg-falcon-cream-200/20"
                }`}
              >
                {LUNCH_WAVE_LABELS[wave].replace(" Lunch", "").replace("No Lunch / Not Applicable", "None")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="fixed left-4 top-4 z-50 flex items-center gap-2">
        <span className="rounded-full bg-falcon-gold-500 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-falcon-brown-950">
          Demo Mode
        </span>
        <Link
          href="/"
          className="rounded-md bg-falcon-brown-950/80 px-3 py-1.5 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-brown-900"
        >
          Exit Demo
        </Link>
      </div>

      <ToolTray tools={tools} timer={timer} currentLesson={currentLesson} />
      <TimerWidget timer={timer} />

      {tools.cleanScreenActive && (
        <CleanScreenOverlay
          message={tools.cleanScreenMessage}
          timeZone={timeZone}
          showClock={data.classroomExperienceSettings.showClockOnCleanScreen}
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
