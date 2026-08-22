/**
 * The Master Calendar references a BellSchedule for today that has no
 * usable block times yet (e.g. a half-day profile known only by name and
 * dismissal time - see Part 6's "never fabricate bell times" rule).
 * Falcon Deck refuses to guess; this tells the teacher exactly what's
 * missing instead of silently falling back to a wrong schedule.
 */
export function UnconfiguredScheduleScreen({ title }: { title?: string }) {
  return (
    <div className="animate-present-fade flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <h1 className="text-5xl font-black text-falcon-cream-100 sm:text-6xl">SCHEDULE SETUP NEEDED</h1>
      {title && <p className="text-lg font-semibold text-falcon-cream-200/80">{title}</p>}
      <p className="max-w-md text-sm text-falcon-cream-200/60">
        This calendar date uses a bell schedule that has not been configured. Add its block times in
        Schedule Setup → Bell Schedules to enable it here.
      </p>
    </div>
  );
}
