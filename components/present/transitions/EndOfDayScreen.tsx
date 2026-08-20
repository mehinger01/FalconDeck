/**
 * Shown instead of a transition when `getPresentationState` reports no
 * next student-facing block today - never a fake "next class". `show`
 * toggles the calm configurable message off (leaving just a quiet blank
 * screen) for teachers who'd rather Present Mode go visually silent at the
 * end of the day; the heading itself is fixed and not worth making
 * configurable.
 */
export function EndOfDayScreen({ show, message }: { show: boolean; message: string }) {
  if (!show) {
    return <div className="flex flex-1" />;
  }

  return (
    <div className="animate-present-fade flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <h1 className="text-4xl font-black text-falcon-cream-100 sm:text-5xl">School Day Complete</h1>
      {message && <p className="text-lg text-falcon-cream-200/70">{message}</p>}
    </div>
  );
}
