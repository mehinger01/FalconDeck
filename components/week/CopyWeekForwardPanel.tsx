"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { copyWeekForward, planCopyWeekForward, type WeekForwardCopyPlan } from "@/lib/week/copyWeekForward";
import { formatWeekRange } from "@/lib/week/formatWeekRange";

/**
 * "Copy Week Forward": detects the whole plan (and any destination
 * conflicts) up front via `planCopyWeekForward`, shows it as a summary,
 * and only writes anything once the teacher picks an explicit option -
 * conflicts are never silently overwritten. The actual writes go through
 * `copyWeekForward`, which itself delegates every write to the existing
 * `copyLessonToSection` action - no copy mechanics are reimplemented here.
 */
export function CopyWeekForwardPanel({
  weekStart,
  classSectionIds,
}: {
  weekStart: string;
  classSectionIds: string[];
}) {
  const { data, actions } = useAppData();
  const [plan, setPlan] = useState<WeekForwardCopyPlan | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  function openPlan() {
    setResultMessage(null);
    setPlan(planCopyWeekForward({ weekStart, classSectionIds, lessons: data.lessons }));
  }

  function runCopy(mode: "non-conflicting-only" | "replace-conflicts") {
    if (!plan) return;
    const result = copyWeekForward(plan, mode, actions.copyLessonToSection);
    setResultMessage(
      `Copied ${result.copied} lesson${result.copied === 1 ? "" : "s"}${
        result.skipped > 0 ? `, skipped ${result.skipped}` : ""
      }.`,
    );
    setPlan(null);
  }

  const totalAffected = plan ? plan.toCopy.length + plan.conflicts.length : 0;

  return (
    <>
      <button
        type="button"
        onClick={openPlan}
        disabled={classSectionIds.length === 0}
        className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Copy Week Forward
      </button>

      {resultMessage && <p className="mt-2 text-xs font-medium text-falcon-brown-700/70">{resultMessage}</p>}

      {plan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-falcon-brown-950/60 p-4"
          onClick={() => setPlan(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-falcon-cream-100 p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-falcon-brown-900">Copy Week Forward</h2>
            <p className="mt-1 text-sm text-falcon-brown-700/70">
              {formatWeekRange(plan.sourceWeekStart)} → {formatWeekRange(plan.destinationWeekStart)}
            </p>

            {totalAffected === 0 ? (
              <p className="mt-4 text-sm text-falcon-brown-700/60">
                Nothing to copy - this week has no prepared lessons yet.
              </p>
            ) : (
              <>
                <div className="mt-4 space-y-1 text-sm text-falcon-brown-900">
                  <p>
                    <span className="font-bold">{totalAffected}</span> lesson{totalAffected === 1 ? "" : "s"} will
                    be copied
                  </p>
                  {plan.conflicts.length > 0 && (
                    <p className="text-falcon-gold-600">
                      <span className="font-bold">{plan.conflicts.length}</span> destination lesson
                      {plan.conflicts.length === 1 ? "" : "s"} already exist{plan.conflicts.length === 1 ? "s" : ""}
                    </p>
                  )}
                </div>

                <div className="mt-5 flex flex-col gap-2">
                  {plan.conflicts.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={() => runCopy("non-conflicting-only")}
                        disabled={plan.toCopy.length === 0}
                        className="rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Copy Non-Conflicting Only ({plan.toCopy.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Replace ${plan.conflicts.length} existing lesson${
                                plan.conflicts.length === 1 ? "" : "s"
                              } at the destination?`,
                            )
                          ) {
                            runCopy("replace-conflicts");
                          }
                        }}
                        className="rounded-md border border-red-800/40 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-800/10"
                      >
                        Replace Conflicts and Copy All ({totalAffected})
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => runCopy("non-conflicting-only")}
                      className="rounded-md bg-falcon-brown-900 px-3 py-2 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
                    >
                      Copy {plan.toCopy.length} Lesson{plan.toCopy.length === 1 ? "" : "s"}
                    </button>
                  )}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => setPlan(null)}
              className="mt-3 w-full rounded-md px-3 py-1.5 text-sm font-medium text-falcon-brown-700 hover:bg-falcon-brown-700/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
