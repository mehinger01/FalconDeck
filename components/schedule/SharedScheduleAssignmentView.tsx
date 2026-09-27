"use client";

import { useAppData } from "@/lib/store/AppDataProvider";
import { isTeachingBlock } from "@/lib/schedule/isTeachingBlock";
import { formatTimeString } from "@/lib/schedule/time";
import type { BellSchedule } from "@/types/schedule";
import { ClassSectionSelect } from "./ClassSectionSelect";

/**
 * Read/assign view for an organization-owned (shared) schedule's blocks -
 * Stage E, join-existing-school initiative. Label/kind/time stay entirely
 * admin-controlled and read-only here, exactly like BuiltInScheduleSummary's
 * display of the same fields; the ONLY thing a teacher can change is which
 * of their own class sections is bound to each teaching block, via
 * setTeacherPeriodAssignment - never a direct write to this schedule's own
 * blocks (see that action's own doc comment in AppDataProvider.tsx for why).
 *
 * Weekday-specific reassignment is explicitly deferred (Stage E scope): this
 * view only ever shows/edits a block's BASE classSectionId, mirroring
 * BlockRow.tsx's own teacher-owned-schedule picker, which also never
 * resolves weekday overrides for display.
 */
export function SharedScheduleAssignmentView({ schedule }: { schedule: BellSchedule }) {
  const { actions } = useAppData();

  return (
    <div>
      <p className="mb-3 rounded-md border border-falcon-brown-700/15 bg-falcon-cream-100/40 px-3 py-2 text-xs text-falcon-brown-700/70">
        This is your school&apos;s shared schedule - period times are set by an administrator. Choose
        which of your own classes meets during each teaching block below.
      </p>
      <ul className="space-y-2">
        {schedule.blocks.map((block) => {
          const canAssignClass = isTeachingBlock(block.kind);
          return (
            <li
              key={block.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-falcon-brown-700/15 bg-white/60 px-4 py-2.5 text-sm"
            >
              <span className="font-semibold text-falcon-brown-900">
                {block.label}
                {block.isLunchWindow && (
                  <span className="ml-2 rounded-full bg-falcon-gold-300/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-falcon-brown-800">
                    Lunch window
                  </span>
                )}
              </span>
              <span className="text-falcon-brown-700/70">
                {formatTimeString(block.startTime)} – {formatTimeString(block.endTime)}
              </span>

              {canAssignClass ? (
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
                  <span className="text-xs font-semibold text-falcon-brown-700/70">Your Class</span>
                  <ClassSectionSelect
                    value={block.classSectionId}
                    onChange={(classSectionId) =>
                      actions.setTeacherPeriodAssignment(schedule.id, block.id, classSectionId)
                    }
                  />
                </label>
              ) : (
                <div className="min-w-[12rem] flex-1 rounded-md border border-falcon-brown-700/15 bg-falcon-cream-100/60 px-2 py-1.5 text-sm text-falcon-brown-700/50">
                  Not applicable
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
