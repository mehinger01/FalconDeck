import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import type { DailyLesson } from "@/types/lesson";

/**
 * The four student-facing lesson panels shown in Present Mode's classroom
 * view: today's agenda (with a live completion toggle), the learning
 * target, resources as large tap-friendly buttons, and announcements. Only
 * rendered once a lesson is known to exist - `ClassroomView` handles the
 * no-lesson state itself.
 */
export function LessonPanels({
  lesson,
  onToggleAgendaItem,
}: {
  lesson: DailyLesson;
  onToggleAgendaItem: (itemId: string) => void;
}) {
  const agendaItems = [...lesson.agendaItems].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="grid w-full max-w-6xl grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
      <section className="flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7">
        <h3 className="text-xl font-bold text-falcon-gold-300 sm:text-2xl">Today&rsquo;s Agenda</h3>
        {agendaItems.length === 0 ? (
          <p className="mt-3 text-base text-falcon-cream-200/60">No agenda items yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {agendaItems.map((item) => (
              <li key={item.id} className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => onToggleAgendaItem(item.id)}
                  aria-pressed={item.isCompleted}
                  aria-label={
                    item.isCompleted
                      ? `Mark "${item.title}" incomplete`
                      : `Mark "${item.title}" complete`
                  }
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 text-sm font-bold transition-colors ${
                    item.isCompleted
                      ? "border-falcon-gold-400 bg-falcon-gold-400 text-falcon-brown-950"
                      : "border-falcon-cream-200/40 text-transparent hover:border-falcon-gold-400"
                  }`}
                >
                  ✓
                </button>
                <div>
                  <p
                    className={`text-base font-medium sm:text-lg ${
                      item.isCompleted
                        ? "text-falcon-cream-200/40 line-through"
                        : "text-falcon-cream-100"
                    }`}
                  >
                    {item.title}
                  </p>
                  {item.details && <p className="text-sm text-falcon-cream-200/50">{item.details}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7">
        <h3 className="text-xl font-bold text-falcon-gold-300 sm:text-2xl">Learning Target</h3>
        <p className="mt-3 text-base text-falcon-cream-200/80 sm:text-lg">
          {lesson.learningTarget || "No learning target set."}
        </p>
      </section>

      <section className="flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7">
        <h3 className="text-xl font-bold text-falcon-gold-300 sm:text-2xl">Resources</h3>
        {lesson.resources.length === 0 ? (
          <p className="mt-3 text-base text-falcon-cream-200/60">No resources linked.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5">
            {lesson.resources.map((resource) => (
              <a
                key={resource.id}
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg bg-falcon-gold-400/90 px-4 py-3.5 text-base font-semibold text-falcon-brown-950 transition-colors hover:bg-falcon-gold-300"
              >
                <span>{resource.title}</span>
                <span className="text-xs font-bold uppercase tracking-wide text-falcon-brown-800">
                  {RESOURCE_TYPE_LABELS[resource.type]}
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7">
        <h3 className="text-xl font-bold text-falcon-gold-300 sm:text-2xl">Announcements</h3>
        {lesson.announcements.length === 0 ? (
          <p className="mt-3 text-base text-falcon-cream-200/60">No announcements.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {lesson.announcements.map((note) => (
              <li key={note.id} className="text-base text-falcon-cream-200/80">
                • {note.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
