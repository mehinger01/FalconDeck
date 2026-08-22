"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppData } from "@/lib/store/AppDataProvider";
import { getOnboardingStatus } from "@/lib/onboarding/getOnboardingStatus";

const CHECKLIST = [
  {
    key: "classes" as const,
    label: "Add your classes",
    href: "/classes",
    description: "Create courses and the class sections that meet each period.",
  },
  {
    key: "schedule" as const,
    label: "Confirm your bell schedule",
    href: "/schedule",
    description: "Add blocks to your default schedule so Present Mode knows the school day.",
  },
  {
    key: "lunchWave" as const,
    label: "Choose your lunch wave",
    href: "/schedule",
    description: "Optional - if your school splits a period into A/B/C lunch waves.",
  },
  {
    key: "masterCalendar" as const,
    label: "Import your Master Calendar",
    href: "/schedule/calendar",
    description: "Optional - lets Falcon Deck automatically know no-school days and special schedules all year.",
  },
  {
    key: "firstLesson" as const,
    label: "Create your first lesson",
    href: "/lessons",
    description: "Add a learning target, agenda item, resource, or announcement to any lesson.",
  },
  {
    key: "arrivalRoutine" as const,
    label: "Add an arrival routine",
    href: "/classes",
    description: "Optional - what students should do when they walk in.",
  },
  {
    key: "libraryResource" as const,
    label: "Add a reusable resource",
    href: "/resources",
    description: "Optional - save a link or file once, then attach it to any lesson.",
  },
];

/**
 * A short Welcome / Setup Checklist rather than a multi-step wizard - see
 * Part 9. Never forces itself on the teacher; it's just a normal,
 * always-reachable page. Every item's completion is derived live from
 * `AppData` via `getOnboardingStatus`, so it can't go stale.
 */
export function OnboardingScreen() {
  const { data } = useAppData();
  const status = getOnboardingStatus(data);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/drive/status")
      .then((response) => response.json())
      .then((body: { configured: boolean; connected: boolean }) => {
        if (cancelled) return;
        setDriveConfigured(body.configured);
        setDriveConnected(body.connected);
      })
      .catch(() => {
        // Not configured/reachable - simply don't show the optional Drive step.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const completionByKey: Record<(typeof CHECKLIST)[number]["key"], boolean> = {
    classes: status.classesComplete,
    schedule: status.scheduleComplete,
    lunchWave: status.lunchWaveComplete,
    masterCalendar: status.masterCalendarComplete,
    firstLesson: status.firstLessonComplete,
    arrivalRoutine: status.arrivalRoutineComplete,
    libraryResource: status.libraryResourceComplete,
  };

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Welcome to Falcon Deck</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          A few steps to get your classroom display ready to run the whole day on its own.
        </p>
        <Link
          href="/demo"
          className="mt-2 inline-block text-sm font-semibold text-falcon-brown-700 underline decoration-falcon-gold-500 decoration-2 underline-offset-2 hover:text-falcon-brown-900"
        >
          Not ready to set up yet? Explore a fully configured Demo →
        </Link>
      </div>

      {status.coreSetupComplete && (
        <div className="mb-4 rounded-lg border border-falcon-gold-500/50 bg-falcon-gold-300/15 p-3 text-sm font-semibold text-falcon-brown-900">
          You&rsquo;re ready to present.
        </div>
      )}

      {status.unresolvedScheduleCount > 0 && (
        <Link
          href="/schedule"
          className="mb-4 block rounded-lg border border-amber-600/40 bg-amber-50 p-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
        >
          {status.unresolvedScheduleCount} special schedule{status.unresolvedScheduleCount === 1 ? "" : "s"} need
          configuration →
        </Link>
      )}

      <ol className="space-y-2">
        {CHECKLIST.map((item, index) => {
          const complete = completionByKey[item.key];
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-start gap-3 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3 transition-colors hover:bg-white"
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    complete
                      ? "bg-falcon-gold-400 text-falcon-brown-950"
                      : "border border-falcon-brown-700/30 text-falcon-brown-700/50"
                  }`}
                >
                  {complete ? "✓" : index + 1}
                </span>
                <div>
                  <p className="font-semibold text-falcon-brown-900">{item.label}</p>
                  <p className="text-xs text-falcon-brown-700/60">{item.description}</p>
                </div>
              </Link>
            </li>
          );
        })}

        <li>
          <Link
            href="/present?mode=preview"
            className="flex items-start gap-3 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3 transition-colors hover:bg-white"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-falcon-brown-700/30 text-xs font-bold text-falcon-brown-700/50"
            >
              {CHECKLIST.length + 1}
            </span>
            <div>
              <p className="font-semibold text-falcon-brown-900">Preview your classroom screen</p>
              <p className="text-xs text-falcon-brown-700/60">
                See exactly what students will see, any time - not just during class.
              </p>
            </div>
          </Link>
        </li>

        {driveConfigured && (
          <li>
            <Link
              href="/resources"
              className="flex items-start gap-3 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-3 transition-colors hover:bg-white"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  driveConnected
                    ? "bg-falcon-gold-400 text-falcon-brown-950"
                    : "border border-falcon-brown-700/30 text-falcon-brown-700/50"
                }`}
              >
                {driveConnected ? "✓" : CHECKLIST.length + 2}
              </span>
              <div>
                <p className="font-semibold text-falcon-brown-900">Connect Google Drive</p>
                <p className="text-xs text-falcon-brown-700/60">
                  Optional - import Docs, Slides, and PDFs into your Resource Library.
                </p>
              </div>
            </Link>
          </li>
        )}
      </ol>
    </div>
  );
}
