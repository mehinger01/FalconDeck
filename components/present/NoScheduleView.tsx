import type { Weekday } from "@/types/schedule";

export function NoScheduleView({ weekday }: { weekday: Weekday }) {
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <h1 className="text-4xl font-black text-falcon-cream-100 sm:text-5xl">
        No blocks scheduled for {label}
      </h1>
      <p className="text-falcon-cream-200/60">
        Add blocks to the default schedule in Schedule Setup to see them here.
      </p>
    </div>
  );
}
