import type { ResolvedScheduleBlock } from "@/types/schedule";
import { CountdownBanner } from "./CountdownBanner";
import { PlaceholderPanel } from "./PlaceholderPanel";

function kindLabel(block: ResolvedScheduleBlock): string {
  return block.kind === "custom" && block.customKindLabel ? block.customKindLabel : block.kind;
}

export function ClassroomView({
  block,
  displayName,
  remainingSeconds,
  showCountdown,
}: {
  block: ResolvedScheduleBlock;
  displayName: string;
  remainingSeconds: number;
  showCountdown: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-10 py-6 text-center sm:px-16">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.3em] text-falcon-gold-400">
          {block.label} · {kindLabel(block)}
        </p>
        <h1 className="mt-3 text-5xl font-black text-falcon-cream-100 sm:text-6xl md:text-7xl">
          {displayName}
        </h1>
      </div>

      {showCountdown && <CountdownBanner remainingSeconds={remainingSeconds} />}

      <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
        <PlaceholderPanel
          title="Today's Agenda"
          note="Placeholder — agenda items will appear here in a future phase."
        />
        <PlaceholderPanel
          title="Learning Target"
          note="Placeholder — today's learning target will appear here."
        />
        <PlaceholderPanel
          title="Resources"
          note="Placeholder — linked resources will appear here."
        />
        <PlaceholderPanel
          title="Announcements"
          note="Placeholder — announcements will appear here."
        />
      </div>
    </div>
  );
}
