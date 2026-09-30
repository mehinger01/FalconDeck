/**
 * The three states the Stage D editor exposes for `materialsOverride`/
 * `warmupOverride` - a UI-facing name for the exact same tri-state
 * `string | null | undefined` convention `resolveTransitionContent`
 * already interprets (see that module's own doc comment). This mapping is
 * one-way and lossless in the direction that matters: every stored value
 * maps to exactly one mode, so the editor's radio selection is always
 * derived directly from persisted state - never a separate "UI mode" that
 * could drift from what's actually saved.
 */
export type TransitionOverrideMode = "default" | "customize" | "hide";

/** `undefined` -> "default" (no override, use the live lesson value); `null` -> "hide"; a string (even `""`) -> "customize". */
export function getTransitionOverrideMode(value: string | null | undefined): TransitionOverrideMode {
  if (value === undefined) return "default";
  if (value === null) return "hide";
  return "customize";
}

/**
 * What text a Customize textarea should seed/restore to the moment a
 * teacher switches INTO customize mode - extracted as its own pure
 * function (used by `TransitionOverrideEditor`'s `onSelectCustom`
 * handlers) specifically so this one rule is independently unit-testable
 * without mounting the component or its `useState` session cache:
 *
 * - `sessionCache` non-null (the teacher already typed a custom value for
 *   this field THIS mounted session, even if they've since switched to
 *   Default/Hide) -> that cached value wins, verbatim - including `""` if
 *   that's what they last typed (an intentionally-cleared custom value is
 *   not the same as "never customized").
 * - `sessionCache` is `null` (never customized this session) -> falls back
 *   to the current live lesson default, or `""` if the lesson has none.
 *
 * `??` (not `||`) throughout - only `null`/`undefined` fall through; an
 * empty-string cache or default is a real, distinct value that must not be
 * silently replaced.
 */
export function resolveCustomizeSeed(sessionCache: string | null, lessonDefault: string | undefined): string {
  return sessionCache ?? lessonDefault ?? "";
}

/**
 * The Stage D sparse-row rule, as a pure predicate: a transition override
 * is only worth persisting once at least one field actually diverges from
 * "use the live lesson default, no note." Shared by the reducer (to decide
 * whether a `SET_TRANSITION_OVERRIDE` dispatch should delete the row
 * instead of upserting it) and by tests, so the two can never drift.
 * `note` is blank-or-absent exactly when its trimmed length is zero - see
 * DailyLesson-adjacent note normalization: trimming only ever decides
 * emptiness, never mutates what gets stored.
 */
export function isFullyDefaultTransitionOverride(fields: {
  materialsOverride?: string | null;
  warmupOverride?: string | null;
  note?: string;
}): boolean {
  return (
    fields.materialsOverride === undefined &&
    fields.warmupOverride === undefined &&
    !(fields.note ?? "").trim()
  );
}
