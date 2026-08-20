"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { findClassPresentationSettings } from "@/lib/data/classPresentation";

/**
 * A section's arrival routine: simple strings shown as a checklist on
 * Present Mode's automatic transition screen (see
 * `components/present/transitions/TransitionScreen.tsx`). Persists
 * through the existing `setArrivalInstructions` store action - the whole
 * list is replaced on each edit rather than needing per-item add/edit/
 * delete actions, since these are just short strings, not a richer model
 * like agenda items.
 */
export function ArrivalRoutineEditor({ classSectionId }: { classSectionId: string }) {
  const { data, actions } = useAppData();
  const instructions =
    findClassPresentationSettings(data.classPresentationSettings, classSectionId)?.arrivalInstructions ?? [];
  const [newInstruction, setNewInstruction] = useState("");

  function save(next: string[]) {
    actions.setArrivalInstructions(classSectionId, next);
  }

  return (
    <div className="mt-2 rounded-lg border border-falcon-brown-700/15 bg-falcon-cream-100/70 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-falcon-brown-700/70">Arrival Routine</p>

      {instructions.length === 0 ? (
        <p className="mb-2 text-xs text-falcon-brown-700/60">Add what students should do when they enter.</p>
      ) : (
        <ul className="mb-2 space-y-1">
          {instructions.map((instruction, index) => (
            <li
              key={`${index}-${instruction}`}
              className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2 py-1 text-sm text-falcon-brown-900"
            >
              <span>{instruction}</span>
              <button
                type="button"
                onClick={() => save(instructions.filter((_, i) => i !== index))}
                className="shrink-0 text-xs font-medium text-red-800 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = newInstruction.trim();
          if (!trimmed) return;
          save([...instructions, trimmed]);
          setNewInstruction("");
        }}
        className="flex gap-2"
      >
        <input
          value={newInstruction}
          onChange={(event) => setNewInstruction(event.target.value)}
          placeholder="e.g. Take out notebook"
          className="flex-1 rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1 text-sm text-falcon-brown-900"
        />
        <button
          type="submit"
          className="rounded-md bg-falcon-brown-900 px-2.5 py-1 text-xs font-semibold text-falcon-cream-100 hover:bg-falcon-brown-800"
        >
          + Add
        </button>
      </form>
    </div>
  );
}
