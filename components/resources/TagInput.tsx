"use client";

import { useState } from "react";

/**
 * Lightweight tag editor: type a tag, press Enter or comma to add it,
 * click a tag's × to remove it. Tags are just `string[]` (Part 5) - no
 * separate Tag entity, no hierarchy.
 */
export function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const trimmed = draft.trim();
    setDraft("");
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-full bg-falcon-gold-300/40 px-2 py-0.5 text-xs font-semibold text-falcon-brown-900"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            aria-label={`Remove tag ${tag}`}
            className="text-falcon-brown-700/60 hover:text-falcon-brown-900"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commitDraft();
          } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commitDraft}
        placeholder={tags.length === 0 ? "Add a tag…" : ""}
        className="min-w-[6rem] flex-1 border-none bg-transparent text-sm text-falcon-brown-900 outline-none"
      />
    </div>
  );
}
