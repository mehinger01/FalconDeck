import Link from "next/link";

/**
 * Shown when teacherSchedulePreferences.activeBellScheduleId is null - no
 * explicit active-schedule selection has been made yet. Distinct from
 * UnconfiguredScheduleScreen (a specific schedule exists but has no block
 * times) - this is "nothing has been chosen at all." Falcon Deck never
 * silently picks one on the teacher's behalf (see
 * lib/schedule/resolveActiveSchedule.ts) - Present Mode simply sends them
 * to choose.
 */
export function SelectScheduleNeededScreen() {
  return (
    <div className="animate-present-fade flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <h1 className="text-5xl font-black text-falcon-cream-100 sm:text-6xl">CHOOSE YOUR SCHEDULE</h1>
      <p className="max-w-md text-sm text-falcon-cream-200/60">
        You haven&rsquo;t chosen an active bell schedule yet. Pick a shared school schedule or one of
        your own in Schedule Setup to start using Present Mode.
      </p>
      <Link
        href="/schedule"
        className="mt-2 rounded-md bg-falcon-gold-400 px-4 py-2 text-sm font-bold text-falcon-brown-950 hover:bg-falcon-gold-300"
      >
        Go to Schedule Setup
      </Link>
    </div>
  );
}
