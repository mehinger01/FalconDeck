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
    <div className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
      <section className="flex min-h-[9rem] flex-col rounded-xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-5 text-left">
        <h3 className="text-lg font-bold text-falcon-gold-300">Today&rsquo;s Agenda</h3>
        {agendaItems.length === 0 ? (
          <p className="mt-2 text-sm text-falcon-cream-200/60">No agenda items yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {agendaItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onToggleAgendaItem(item.id)}
                  aria-pressed={item.isCompleted}
                  aria-label={
                    item.isCompleted
                      ? `Mark "${item.title}" incomplete`
                      : `Mark "${item.title}" complete`
                  }
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs font-bold transition-colors ${
                    item.isCompleted
                      ? "border-falcon-gold-400 bg-falcon-gold-400 text-falcon-brown-950"
                      : "border-falcon-cream-200/40 text-transparent hover:border-falcon-gold-400"
                  }`}
                >
                  ✓
                </button>
                <div>
                  <p
                    className={`text-sm font-medium ${
                      item.isCompleted
                        ? "text-falcon-cream-200/40 line-through"
                        : "text-falcon-cream-100"
                    }`}
                  >
                    {item.title}
                  </p>
                  {item.details && <p className="text-xs text-falcon-cream-200/50">{item.details}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex min-h-[9rem] flex-col rounded-xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-5 text-left">
        <h3 className="text-lg font-bold text-falcon-gold-300">Learning Target</h3>
        <p className="mt-2 text-sm text-falcon-cream-200/80">
          {lesson.learningTarget || "No learning target set."}
        </p>
      </section>

      <section className="flex min-h-[9rem] flex-col rounded-xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-5 text-left">
        <h3 className="text-lg font-bold text-falcon-gold-300">Resources</h3>
        {lesson.resources.length === 0 ? (
          <p className="mt-2 text-sm text-falcon-cream-200/60">No resources linked.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {lesson.resources.map((resource) => (
              <a
                key={resource.id}
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg bg-falcon-gold-400/90 px-4 py-3 font-semibold text-falcon-brown-950 transition-colors hover:bg-falcon-gold-300"
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

      <section className="flex min-h-[9rem] flex-col rounded-xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-5 text-left">
        <h3 className="text-lg font-bold text-falcon-gold-300">Announcements</h3>
        {lesson.announcements.length === 0 ? (
          <p className="mt-2 text-sm text-falcon-cream-200/60">No announcements.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {lesson.announcements.map((note) => (
              <li key={note.id} className="text-sm text-falcon-cream-200/80">
                • {note.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
