"use client";

import { useState } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { findTransitionOverride } from "@/lib/data/transitionContent";
import {
  getTransitionOverrideMode,
  resolveCustomizeSeed,
  type TransitionOverrideMode,
} from "@/lib/data/transitionOverrideMode";

const MODE_OPTIONS: { mode: TransitionOverrideMode; label: string }[] = [
  { mode: "default", label: "Use Lesson Default" },
  { mode: "customize", label: "Customize" },
  { mode: "hide", label: "Hide" },
];

/**
 * One field's tri-state control: a proper radio `<fieldset>` (native
 * radios, so keyboard/tab/label semantics come for free - see Stage D's
 * own "no custom interaction that can't be tabbed" requirement) plus,
 * only in "default" mode, a live preview of what the live lesson value
 * currently is. `currentDefault` must always be the CURRENT lesson draft
 * value (the same `lesson?.materials`/`lesson?.warmup` the Materials/
 * Warm-Up textareas above already show) - never a stale/persisted
 * snapshot - so the preview updates the instant the teacher edits that
 * field on this same page.
 */
function OverrideModeField({
  legend,
  name,
  mode,
  currentDefault,
  customValue,
  onSelectDefault,
  onSelectHide,
  onSelectCustom,
  onCustomChange,
}: {
  legend: string;
  name: string;
  mode: TransitionOverrideMode;
  currentDefault: string | undefined;
  customValue: string;
  onSelectDefault: () => void;
  onSelectHide: () => void;
  /** Fired only when switching INTO customize mode - restores this session's last custom text if one exists, otherwise seeds from the current lesson default (see the parent component's own doc comment). */
  onSelectCustom: () => void;
  onCustomChange: (value: string) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-falcon-brown-700/15 bg-white p-3">
      <legend className="px-1 text-xs font-bold uppercase tracking-wide text-falcon-brown-700/70">{legend}</legend>

      <div className="mt-1 flex flex-wrap gap-1 rounded-md bg-falcon-cream-100/70 p-1" role="radiogroup" aria-label={legend}>
        {MODE_OPTIONS.map((option) => (
          <label
            key={option.mode}
            className={`flex-1 cursor-pointer rounded px-2 py-1 text-center text-xs font-semibold transition-colors ${
              mode === option.mode
                ? "bg-falcon-brown-900 text-falcon-cream-100"
                : "text-falcon-brown-700/80 hover:bg-falcon-brown-700/10"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.mode}
              checked={mode === option.mode}
              onChange={() => {
                if (option.mode === "default") onSelectDefault();
                else if (option.mode === "hide") onSelectHide();
                else onSelectCustom();
              }}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>

      {mode === "default" && (
        <p className="mt-2 whitespace-pre-line text-sm text-falcon-brown-700/70">
          <span className="font-semibold text-falcon-brown-700/90">Using: </span>
          {currentDefault?.trim() ? currentDefault : "None"}
        </p>
      )}

      {mode === "customize" && (
        <textarea
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          rows={2}
          className="mt-2 w-full rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
        />
      )}

      {mode === "hide" && (
        <p className="mt-2 text-sm text-falcon-brown-700/60">This section will not appear on the passing screen.</p>
      )}
    </fieldset>
  );
}

/**
 * Teacher Transition Content (Stage D): edits the `TransitionOverride` for
 * (date, classSectionId) - NEVER a schedule block, and no internal
 * schedule/block id is ever read or shown here (see the design report's
 * Section 3/5: this is keyed purely by destination class + date, on
 * purpose, so it survives schedule changes and works identically for a
 * shared or private schedule). Renders unconditionally, independent of
 * whether a DailyLesson exists for this date/section - Stage B's dedicated
 * `transition_overrides` table exists specifically so this never has to
 * force a lesson into existence.
 *
 * Matches this page's own established editing convention (see
 * LessonsScreen.tsx's Materials/Learning Target fields): every control
 * dispatches directly on change, no local draft, no Save/Cancel - the
 * reducer (`SET_TRANSITION_OVERRIDE`) is what actually keeps
 * `transitionOverrides` sparse (see lib/data/transitionOverrideMode.ts's
 * isFullyDefaultTransitionOverride), not this component.
 */
export function TransitionOverrideEditor({
  date,
  classSectionId,
  lessonMaterials,
  lessonWarmup,
}: {
  date: string;
  classSectionId: string;
  /** The CURRENT lesson draft's materials - i.e. `lesson?.materials` from the same render, not a separately-fetched/stale value. */
  lessonMaterials: string | undefined;
  /** Same as `lessonMaterials`, for warmup. */
  lessonWarmup: string | undefined;
}) {
  const { data, actions } = useAppData();
  const override = findTransitionOverride(data.transitionOverrides, date, classSectionId);

  const materialsMode = getTransitionOverrideMode(override?.materialsOverride);
  const warmupMode = getTransitionOverrideMode(override?.warmupOverride);

  // Session-local convenience cache (see the component's own doc comment) -
  // plain useState, never written from an effect, so mounting this
  // component still dispatches nothing. Purpose: ONLY remembers what to
  // restore if the teacher switches Customize -> Default/Hide -> Customize
  // again without leaving this page - it plays no role in what's rendered
  // while already in customize mode (the textarea there always shows the
  // real persisted override, kept in sync by the same setter that updates
  // this cache). Resets naturally on remount (LessonsScreen keys this
  // component by date+classSectionId), which is correct: a different day/
  // class is a different editing session, not the same one continuing.
  const [materialsCache, setMaterialsCache] = useState<string | null>(null);
  const [warmupCache, setWarmupCache] = useState<string | null>(null);

  return (
    <section className="rounded-xl border border-falcon-gold-500/40 bg-falcon-gold-300/10 p-4">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-falcon-brown-700/70">
        Transition / Passing Screen
      </h2>
      <p className="mb-3 text-xs text-falcon-brown-700/60">
        Controls what Present Mode automatically shows students during the passing period right
        before this class. Defaults to the lesson content above; override only what you need to
        change.
      </p>

      <div className="space-y-3">
        <OverrideModeField
          legend="Materials"
          name={`transition-materials-mode-${date}-${classSectionId}`}
          mode={materialsMode}
          currentDefault={lessonMaterials}
          customValue={override?.materialsOverride ?? ""}
          onSelectDefault={() => actions.setTransitionMaterialsDefault(date, classSectionId)}
          onSelectHide={() => actions.setTransitionMaterialsHidden(date, classSectionId)}
          // Restores this session's last custom text if the teacher has
          // already typed one (even after visiting Default/Hide in
          // between); only falls back to seeding from the current lesson
          // default the FIRST time Customize is chosen this session (see
          // the design report's Section 16 rationale for seeding from the
          // default at all).
          onSelectCustom={() => {
            const seed = resolveCustomizeSeed(materialsCache, lessonMaterials);
            setMaterialsCache(seed);
            actions.setTransitionMaterialsCustom(date, classSectionId, seed);
          }}
          onCustomChange={(value) => {
            setMaterialsCache(value);
            actions.setTransitionMaterialsCustom(date, classSectionId, value);
          }}
        />

        <OverrideModeField
          legend="Warm-Up"
          name={`transition-warmup-mode-${date}-${classSectionId}`}
          mode={warmupMode}
          currentDefault={lessonWarmup}
          customValue={override?.warmupOverride ?? ""}
          onSelectDefault={() => actions.setTransitionWarmupDefault(date, classSectionId)}
          onSelectHide={() => actions.setTransitionWarmupHidden(date, classSectionId)}
          onSelectCustom={() => {
            const seed = resolveCustomizeSeed(warmupCache, lessonWarmup);
            setWarmupCache(seed);
            actions.setTransitionWarmupCustom(date, classSectionId, seed);
          }}
          onCustomChange={(value) => {
            setWarmupCache(value);
            actions.setTransitionWarmupCustom(date, classSectionId, value);
          }}
        />

        <div className="rounded-lg border border-falcon-brown-700/15 bg-white p-3">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-falcon-brown-700/70">
              Transition Note
            </span>
            <p className="mb-2 mt-1 text-xs text-falcon-brown-700/60">
              Optional message shown during the passing screen before this class.
            </p>
            <textarea
              value={override?.note ?? ""}
              onChange={(e) => actions.setTransitionNote(date, classSectionId, e.target.value)}
              rows={2}
              className="w-full rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
