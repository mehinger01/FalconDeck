/**
 * Placeholder architecture only (Phase 4 scope). A real random picker
 * needs a roster/name-list data source, which is explicitly out of scope
 * this phase - this shell exists so the tray's six tools are all present
 * and so a future phase can implement the real thing without touching the
 * tray itself.
 */
export function RandomPickerPanel() {
  return (
    <p className="text-xs text-falcon-cream-200/60">
      Random Picker is coming in a future update - it&rsquo;ll need a class roster first.
    </p>
  );
}
