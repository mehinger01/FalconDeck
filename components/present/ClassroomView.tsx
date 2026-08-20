import { useAppData } from "@/lib/store/AppDataProvider";
import type { DailyLesson } from "@/types/lesson";
import type { ResolvedScheduleBlock } from "@/types/schedule";
import { CountdownBanner } from "./CountdownBanner";
import { LessonPanels } from "./LessonPanels";

function kindLabel(block: ResolvedScheduleBlock): string {
  return block.kind === "custom" && block.customKindLabel ? block.customKindLabel : block.kind;
}

export function ClassroomView({
  block,
  displayName,
  remainingSeconds,
  showCountdown,
  dateKey,
  lesson,
  noLessonMessage = "No lesson has been prepared for today.",
  finalFiveMessage = "",
}: {
  block: ResolvedScheduleBlock;
  displayName: string;
  remainingSeconds: number;
  showCountdown: boolean;
  dateKey: string;
  lesson: DailyLesson | null;
  /** Overridable so Preview Mode can name the date it's actually showing, instead of always saying "today". */
  noLessonMessage?: string;
  /** Optional teacher-configured note shown only alongside the final-5:00 countdown, e.g. "Wrap up today's work." */
  finalFiveMessage?: string;
}) {
  const { actions } = useAppData();

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

      {showCountdown && (
        <div className="animate-present-fade flex flex-col items-center gap-2">
          <CountdownBanner remainingSeconds={remainingSeconds} />
          {finalFiveMessage && (
            <p className="text-sm font-medium text-falcon-cream-200/70">{finalFiveMessage}</p>
          )}
        </div>
      )}

      {lesson ? (
        <LessonPanels
          lesson={lesson}
          onToggleAgendaItem={(itemId) =>
            actions.toggleAgendaItemCompleted(dateKey, lesson.classSectionId, itemId)
          }
        />
      ) : (
        <div className="w-full max-w-2xl rounded-xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 px-8 py-10">
          <p className="text-2xl font-bold text-falcon-cream-100">{noLessonMessage}</p>
          <p className="mt-2 text-sm text-falcon-cream-200/60">
            Add one from the Lessons screen and it will appear here automatically.
          </p>
        </div>
      )}
    </div>
  );
}
