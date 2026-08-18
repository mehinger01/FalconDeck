import { secondsToClock } from "@/lib/schedule/time";

export function CountdownBanner({
  remainingSeconds,
  label = "Time Remaining",
}: {
  remainingSeconds: number;
  label?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center rounded-2xl border-4 border-falcon-gold-500 bg-falcon-brown-950/60 px-8 py-6 shadow-lg">
      <p className="text-sm font-bold uppercase tracking-[0.3em] text-falcon-gold-400">{label}</p>
      <p
        className="mt-2 font-mono text-7xl font-black tabular-nums text-falcon-gold-300 sm:text-8xl"
        aria-live="polite"
      >
        {secondsToClock(remainingSeconds)}
      </p>
    </div>
  );
}
