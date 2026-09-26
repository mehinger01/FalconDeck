import type { BellSchedule } from "@/types/schedule";
import { formatTimeString } from "@/lib/schedule/time";

/**
 * Read-only view for a schedule the teacher can't edit directly - either a
 * built-in preset, or (Stage D) an organization-owned shared schedule - or
 * one still "Needs Configuration". Avoids destructive editing of the
 * canonical schedule while still letting a teacher see exactly what it
 * contains.
 */
export function BuiltInScheduleSummary({ schedule }: { schedule: BellSchedule }) {
  const isSharedSchedule = schedule.ownerType === "organization";

  if (schedule.needsConfiguration || schedule.blocks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-amber-600/40 bg-amber-50 p-6 text-center text-sm text-amber-900">
        <p className="font-semibold">Needs Configuration</p>
        <p className="mt-1">
          {isSharedSchedule
            ? "This shared schedule has no period times yet. An administrator needs to add them."
            : "The Master Calendar references this schedule by name, but its actual period times haven’t been supplied yet. Falcon Deck never guesses bell times - add the blocks below (or duplicate this schedule) once you know the real sequence."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 rounded-md border border-falcon-brown-700/15 bg-falcon-cream-100/40 px-3 py-2 text-xs text-falcon-brown-700/70">
        {isSharedSchedule
          ? "This is your school's shared schedule - only an administrator can edit it."
          : "This is a built-in schedule - it can’t be edited directly. Duplicate it to create your own customizable copy."}
      </p>
      <ul className="space-y-2">
        {schedule.blocks.map((block) => (
          <li
            key={block.id}
            className="flex items-center justify-between rounded-lg border border-falcon-brown-700/15 bg-white/60 px-4 py-2.5 text-sm"
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
          </li>
        ))}
      </ul>
    </div>
  );
}
