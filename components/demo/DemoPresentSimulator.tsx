"use client";

import Link from "next/link";
import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { useSimulatedNow } from "@/lib/hooks/useSimulatedNow";
import { useClassroomTimer } from "@/lib/tools/timer/useClassroomTimer";
import { DEMO_SCENARIOS } from "@/lib/data/demoScenarios";
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

/**
 * Demo Mode's proof that the real engine works, not a static slideshow:
 * every scenario button feeds a concrete simulated Date into the exact
 * same `LivePresentScreen` Live Present Mode uses (Part 15). The lunch
 * wave selector dispatches through the same isolated demo AppData the
 * rest of `/demo` uses (see DemoAppDataProvider) - changing it live
 * changes what the "Lunch" scenario resolves to, exactly like flipping
 * the real teacher preference would.
 */
export function DemoPresentSimulator() {
  const { data, actions } = useAppData();
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [currentLesson, setCurrentLesson] = useState<DailyLesson | null>(null);
  const scenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId) ?? null;
  const simulatedNow = useSimulatedNow(scenario ? scenario.getDate() : null);

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
          <h1 className="text-4xl font-black">Choose a scenario below to begin</h1>
          <p className="max-w-md text-sm text-falcon-cream-200/60">
            Each button feeds a real simulated date/time into Falcon Deck&rsquo;s actual scheduling engine -
            not a slideshow.
          </p>
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
        <div className="pointer-events-auto flex max-w-4xl flex-wrap items-center justify-center gap-2 rounded-xl border border-falcon-cream-200/10 bg-falcon-brown-950/95 p-3 shadow-2xl">
          {DEMO_SCENARIOS.map((s) => (
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
                onClick={() => actions.updateTeacherSchedulePreferences({ lunchWave: wave })}
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
