"use client";

import { useAppData } from "@/lib/store/AppDataProvider";
import type { BellSchedule } from "@/types/schedule";
import { BlockRow } from "./BlockRow";

export function BlockList({ schedule }: { schedule: BellSchedule }) {
  const { actions } = useAppData();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
          Blocks
        </h3>
        <button
          type="button"
          onClick={() => actions.addBlock(schedule.id)}
          className="rounded-md bg-falcon-brown-900 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
        >
          + Add Block
        </button>
      </div>

      {schedule.blocks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-falcon-brown-700/30 p-6 text-center text-sm text-falcon-brown-700/60">
          No blocks yet. Add one to get started.
        </p>
      ) : (
        <ul className="space-y-3">
          {schedule.blocks.map((block, index) => (
            <BlockRow
              key={block.id}
              scheduleId={schedule.id}
              block={block}
              isFirst={index === 0}
              isLast={index === schedule.blocks.length - 1}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
