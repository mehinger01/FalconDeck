"use client";

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

  const completionByKey: Record<(typeof CHECKLIST)[number]["key"], boolean> = {
    classes: status.classesComplete,
    schedule: status.scheduleComplete,
    firstLesson: status.firstLessonComplete,
    arrivalRoutine: status.arrivalRoutineComplete,
  };

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-falcon-brown-900">Welcome to Falcon Deck</h1>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          A few steps to get your classroom display ready to run the whole day on its own.
        </p>
      </div>

      {status.coreSetupComplete && (
        <div className="mb-4 rounded-lg border border-falcon-gold-500/50 bg-falcon-gold-300/15 p-3 text-sm font-semibold text-falcon-brown-900">
          You&rsquo;re ready to present.
        </div>
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
              5
            </span>
            <div>
              <p className="font-semibold text-falcon-brown-900">Preview your classroom screen</p>
              <p className="text-xs text-falcon-brown-700/60">
                See exactly what students will see, any time - not just during class.
              </p>
            </div>
          </Link>
        </li>
      </ol>
    </div>
  );
}
