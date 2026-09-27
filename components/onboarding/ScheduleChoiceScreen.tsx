"use client";

import Link from "next/link";
import { useAppData, useActiveSchedule } from "@/lib/store/AppDataProvider";
import { isUsableSharedSchedule } from "@/lib/schedule/isUsableSharedSchedule";
import { isRecommendedSchedule } from "@/lib/schedule/isRecommendedSchedule";
import { formatTimeString } from "@/lib/schedule/time";
import type { BellSchedule } from "@/types/schedule";

function ScheduleSummary({ schedule }: { schedule: BellSchedule }) {
  const startTime = schedule.blocks[0]?.startTime;
  const endTime = schedule.blocks[schedule.blocks.length - 1]?.endTime;
  return (
    <span className="block text-xs text-falcon-brown-700/60">
      {schedule.blocks.length} block{schedule.blocks.length === 1 ? "" : "s"}
      {startTime && endTime && (
        <>
          {" "}
          · {formatTimeString(startTime)} – {formatTimeString(endTime)}
        </>
      )}
    </span>
  );
}

/**
 * The mandatory Stage F onboarding step (/setup/schedule, join-existing-
 * school initiative) - a teacher must leave this step having explicitly
 * picked an active schedule (see lib/store/ActiveScheduleGate.tsx, which is
 * what actually enforces that requirement; this component only ever offers
 * the choice, it never redirects on its own).
 *
 * Branches purely on live AppData - never on membership.role or
 * account_origin (a founder's brand-new school and a joiner's school that
 * simply has no shared schedules YET are indistinguishable here, and must
 * be: nothing here assumes "joined" implies shared schedules exist, or
 * that "created" implies they never will).
 */
export function ScheduleChoiceScreen() {
  const { data, actions } = useAppData();
  const activeSchedule = useActiveSchedule();

  const usableSharedSchedules = data.schedules.filter(isUsableSharedSchedule);
  const hasClassSections = data.classSections.length > 0;

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Choose your schedule</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          Falcon Deck needs to know which bell schedule to follow before it can run your classroom
          display.
        </p>
      </div>

      {activeSchedule && (
        <div className="mb-6 rounded-lg border border-falcon-gold-500/50 bg-falcon-gold-300/15 p-3 text-sm">
          <p className="font-semibold text-falcon-brown-900">
            You&rsquo;re using &ldquo;{activeSchedule.name}&rdquo;.
          </p>
          <p className="mt-1 text-falcon-brown-700/70">
            {hasClassSections ? (
              <>
                Next, you can{" "}
                <Link href="/schedule" className="font-semibold underline decoration-falcon-gold-500 decoration-2 underline-offset-2">
                  assign your classes to periods
                </Link>{" "}
                - optional, and you can always come back later.
              </>
            ) : (
              <>
                Next,{" "}
                <Link href="/classes" className="font-semibold underline decoration-falcon-gold-500 decoration-2 underline-offset-2">
                  set up your classes
                </Link>
                .
              </>
            )}
          </p>
          <Link
            href="/setup"
            className="mt-2 inline-block font-semibold text-falcon-brown-700 underline decoration-falcon-gold-500 decoration-2 underline-offset-2 hover:text-falcon-brown-900"
          >
            Continue setup →
          </Link>
        </div>
      )}

      {usableSharedSchedules.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
            Use a school schedule
          </h2>
          <ul className="space-y-2">
            {usableSharedSchedules.map((schedule) => {
              const isActive = activeSchedule?.id === schedule.id;
              const isRecommended = isRecommendedSchedule(schedule);
              return (
                <li
                  key={schedule.id}
                  className="rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3"
                >
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold text-falcon-brown-900">
                    {schedule.name}
                    {isRecommended && (
                      <span className="rounded-full bg-falcon-gold-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-falcon-brown-950">
                        Recommended
                      </span>
                    )}
                  </span>
                  <ScheduleSummary schedule={schedule} />
                  <div className="mt-2">
                    {isActive ? (
                      <span className="text-xs font-semibold text-green-800">Currently in use</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => actions.setActiveBellSchedule(schedule.id)}
                        className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-xs font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20"
                      >
                        Use this schedule
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
          Build my own schedule
        </h2>
        <p className="mb-2 text-sm text-falcon-brown-700/70">
          {usableSharedSchedules.length > 0
            ? "Prefer to set up your own bell schedule instead? You can still switch to a school schedule later."
            : "Your school doesn't have a shared schedule set up yet - build your own to get started."}
        </p>
        <Link
          href="/schedule"
          className="inline-block rounded-md bg-falcon-brown-900 px-4 py-2 text-sm font-semibold text-falcon-cream-100"
        >
          Go to Schedule Setup
        </Link>
      </div>
    </div>
  );
}
