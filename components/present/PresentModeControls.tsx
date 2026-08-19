"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/lib/store/AppDataProvider";
import type { ResolvedScheduleBlock } from "@/types/schedule";

export type PresentMode = "live" | "preview";

function buildPresentUrl(params: {
  mode: PresentMode;
  date: string;
  classSectionId: string | null;
  blockId: string | null;
}): string {
  if (params.mode === "live") return "/present";
  const query = new URLSearchParams({ mode: "preview", date: params.date });
  if (params.classSectionId) query.set("section", params.classSectionId);
  if (params.blockId) query.set("block", params.blockId);
  return `/present?${query.toString()}`;
}

/**
 * Discreet teacher-facing controls, collapsed by default so the student
 * presentation stays clean on a projector - see `PreviewPresentScreen`'s
 * and `LivePresentScreen`'s docs for how Live/Preview actually differ.
 * Every selection here is a query-param navigation (`router.replace`),
 * never local component state, so a preview URL can be bookmarked or
 * refreshed and still show the same thing (Phase 2.5 requirement 8).
 */
export function PresentModeControls({
  mode,
  date,
  classSectionId,
  blockId,
  blockOptions,
}: {
  mode: PresentMode;
  date: string;
  classSectionId: string | null;
  blockId: string | null;
  blockOptions: ResolvedScheduleBlock[];
}) {
  const router = useRouter();
  const { data } = useAppData();
  const [expanded, setExpanded] = useState(false);

  function go(next: Partial<{ mode: PresentMode; date: string; classSectionId: string | null; blockId: string | null }>) {
    router.replace(
      buildPresentUrl({
        mode: next.mode ?? mode,
        date: next.date ?? date,
        classSectionId: next.classSectionId !== undefined ? next.classSectionId : classSectionId,
        blockId: next.blockId !== undefined ? next.blockId : blockId,
      }),
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="absolute bottom-3 left-4 z-10 text-xs text-falcon-cream-200/20 transition-colors hover:text-falcon-cream-200/60"
      >
        {mode === "preview" ? "Preview Mode" : "Preview…"}
      </button>
    );
  }

  return (
    <div className="absolute bottom-3 left-4 z-10 flex w-64 flex-col gap-2 rounded-lg border border-falcon-cream-200/10 bg-falcon-brown-950/95 p-3 text-xs shadow-xl">
      <div className="flex items-center justify-between">
        <div className="flex overflow-hidden rounded-md border border-falcon-cream-200/20">
          <button
            type="button"
            onClick={() => go({ mode: "live" })}
            className={`px-2 py-1 font-semibold ${
              mode === "live"
                ? "bg-falcon-gold-400 text-falcon-brown-950"
                : "text-falcon-cream-200/70 hover:bg-falcon-cream-200/10"
            }`}
          >
            Live
          </button>
          <button
            type="button"
            onClick={() => go({ mode: "preview" })}
            className={`px-2 py-1 font-semibold ${
              mode === "preview"
                ? "bg-falcon-gold-400 text-falcon-brown-950"
                : "text-falcon-cream-200/70 hover:bg-falcon-cream-200/10"
            }`}
          >
            Preview
          </button>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Collapse preview controls"
          className="text-falcon-cream-200/40 hover:text-falcon-cream-200/80"
        >
          ✕
        </button>
      </div>

      <label className={`flex flex-col gap-1 ${mode === "live" ? "opacity-40" : ""}`}>
        <span className="font-semibold text-falcon-cream-200/50">Date</span>
        <input
          type="date"
          value={date}
          disabled={mode === "live"}
          onChange={(e) => go({ mode: "preview", date: e.target.value })}
          className="rounded border border-falcon-cream-200/20 bg-falcon-brown-900 px-2 py-1 text-falcon-cream-100 disabled:cursor-not-allowed"
        />
      </label>

      <label className={`flex flex-col gap-1 ${mode === "live" ? "opacity-40" : ""}`}>
        <span className="font-semibold text-falcon-cream-200/50">Class Section</span>
        <select
          value={classSectionId ?? ""}
          disabled={mode === "live"}
          onChange={(e) => go({ mode: "preview", classSectionId: e.target.value || null, blockId: null })}
          className="rounded border border-falcon-cream-200/20 bg-falcon-brown-900 px-2 py-1 text-falcon-cream-100 disabled:cursor-not-allowed"
        >
          <option value="">— Choose —</option>
          {data.classSections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
      </label>

      {mode === "preview" && blockOptions.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-falcon-cream-200/50">Period (optional)</span>
          <select
            value={blockId ?? ""}
            onChange={(e) => go({ blockId: e.target.value || null })}
            className="rounded border border-falcon-cream-200/20 bg-falcon-brown-900 px-2 py-1 text-falcon-cream-100"
          >
            {blockOptions.map((block) => (
              <option key={block.id} value={block.id}>
                {block.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
