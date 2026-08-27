"use client";

import { useAppData } from "@/lib/store/AppDataProvider";
import type { ScheduleBlock } from "@/types/schedule";
import { BlockOverrideEditor } from "./BlockOverrideEditor";
import { ClassSectionSelect } from "./ClassSectionSelect";
import { KindSelect } from "./KindSelect";

export function BlockRow({
  scheduleId,
  block,
  isFirst,
  isLast,
}: {
  scheduleId: string;
  block: ScheduleBlock;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { actions } = useAppData();
  const canAssignClass = block.kind === "instructional" || block.kind === "enrichment";

  function changeKind(kind: ScheduleBlock["kind"]) {
    const nextCanAssignClass = kind === "instructional" || kind === "enrichment";
    actions.updateBlock(scheduleId, block.id, {
      kind,
      ...(nextCanAssignClass ? {} : { classSectionId: null }),
    });
  }

  return (
    <li className="rounded-xl border border-falcon-brown-700/15 bg-white/60 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Order</span>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Move block earlier"
              disabled={isFirst}
              onClick={() => actions.moveBlock(scheduleId, block.id, "up")}
              className="rounded-md border border-falcon-brown-700/30 px-2 py-1 text-sm text-falcon-brown-900 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move block later"
              disabled={isLast}
              onClick={() => actions.moveBlock(scheduleId, block.id, "down")}
              className="rounded-md border border-falcon-brown-700/30 px-2 py-1 text-sm text-falcon-brown-900 disabled:opacity-30"
            >
              ↓
            </button>
          </div>
        </div>

        <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Label</span>
          <input
            value={block.label}
            onChange={(e) => actions.updateBlock(scheduleId, block.id, { label: e.target.value })}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Kind</span>
          <KindSelect value={block.kind} onChange={changeKind} />
        </label>

        {block.kind === "custom" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Custom Label</span>
            <input
              value={block.customKindLabel ?? ""}
              onChange={(e) =>
                actions.updateBlock(scheduleId, block.id, { customKindLabel: e.target.value })
              }
              className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">Start</span>
          <input
            type="time"
            value={block.startTime}
            onChange={(e) => actions.updateBlock(scheduleId, block.id, { startTime: e.target.value })}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-falcon-brown-700/70">End</span>
          <input
            type="time"
            value={block.endTime}
            onChange={(e) => actions.updateBlock(scheduleId, block.id, { endTime: e.target.value })}
            className="rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
          />
        </label>

        {canAssignClass ? (
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Assigned Class</span>
            <ClassSectionSelect
              value={block.classSectionId}
              onChange={(classSectionId) =>
                actions.updateBlock(scheduleId, block.id, { classSectionId })
              }
            />
          </label>
        ) : (
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-falcon-brown-700/70">Assigned Class</span>
            <div className="rounded-md border border-falcon-brown-700/15 bg-falcon-cream-100/60 px-2 py-1.5 text-sm text-falcon-brown-700/50">
              Not applicable
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => actions.deleteBlock(scheduleId, block.id)}
          className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-800/10"
        >
          Delete
        </button>
      </div>

      <BlockOverrideEditor scheduleId={scheduleId} block={block} />
    </li>
  );
}
