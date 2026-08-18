"use client";

import { BLOCK_KINDS, type BlockKind } from "@/types/schedule";

const KIND_LABELS: Record<BlockKind, string> = {
  instructional: "Instructional",
  enrichment: "Enrichment",
  prep: "Prep",
  lunch: "Lunch",
  passing: "Passing",
  custom: "Custom…",
};

export function KindSelect({
  value,
  onChange,
  id,
}: {
  value: BlockKind;
  onChange: (kind: BlockKind) => void;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as BlockKind)}
      className="w-full rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
    >
      {BLOCK_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {KIND_LABELS[kind]}
        </option>
      ))}
    </select>
  );
}
