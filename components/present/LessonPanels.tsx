import { RESOURCE_TYPE_LABELS } from "@/lib/data/lessons";
import type { DailyLesson } from "@/types/lesson";

/**
 * The student-facing lesson panels shown in Present Mode's classroom view:
 * today's agenda (with a live completion toggle), the learning target,
 * materials (only when the lesson has any - a teacher-prep-list field, not
 * required like the others), resources as large tap-friendly buttons, and
 * announcements. Only rendered once a lesson is known to exist -
 * `ClassroomView` handles the no-lesson state itself. Shared by both Live
 * and Preview Mode (see `ClassroomView`), so this is the only place either
 * mode's panels are defined - they can never diverge.
 */
export function LessonPanels({
  lesson,
  onToggleAgendaItem,
}: {
  lesson: DailyLesson;
  onToggleAgendaItem: (itemId: string) => void;
}) {
  const agendaItems = [...lesson.agendaItems].sort((a, b) => a.sortOrder - b.sortOrder);
  const hasMaterials = Boolean(lesson.materials?.trim());
  // At the BenQ presentation tier (see .present-grid in globals.css), Agenda
  // and Materials join Learning Target in a 3-up row when Materials is
  // present, and both widen to a 2-up row (matching Resources/Announcements
  // below) when it's not. Agenda and Materials get more of that row's width
  // than Learning Target ("wide" vs "narrow") - real agenda/materials text
  // wraps to many lines in a narrow column even at a 24px floor, while a
  // learning target is normally one or two short sentences with headroom to
  // spare - so the row's real vertical driver (Agenda/Materials) gets the
  // width it actually needs instead of three forced-equal columns.
  const wideOrHalf = hasMaterials ? "wide" : "half";
  const narrowOrHalf = hasMaterials ? "narrow" : "half";

  return (
    <div className="present-grid grid w-full max-w-6xl grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
      <section
        data-span={wideOrHalf}
        className="present-card flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7"
      >
        <h3 className="present-card-heading text-xl font-bold text-falcon-gold-300 sm:text-2xl">
          Today&rsquo;s Agenda
        </h3>
        {agendaItems.length === 0 ? (
          <p className="present-card-body present-card-section-gap mt-3 text-base text-falcon-cream-200/60">
            No agenda items yet.
          </p>
        ) : (
          <ul className="present-agenda-list mt-3 space-y-3">
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
                  className={`present-checkbox mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 text-sm font-bold transition-colors ${
                    item.isCompleted
                      ? "border-falcon-gold-400 bg-falcon-gold-400 text-falcon-brown-950"
                      : "border-falcon-cream-200/40 text-transparent hover:border-falcon-gold-400"
                  }`}
                >
                  ✓
                </button>
                <div>
                  <p
                    className={`present-card-body text-base font-medium sm:text-lg ${
                      item.isCompleted
                        ? "text-falcon-cream-200/40 line-through"
                        : "text-falcon-cream-100"
                    }`}
                  >
                    {item.title}
                  </p>
                  {item.details && (
                    <p className="present-card-detail text-sm text-falcon-cream-200/50">{item.details}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        data-span={narrowOrHalf}
        className="present-card flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7"
      >
        <h3 className="present-card-heading text-xl font-bold text-falcon-gold-300 sm:text-2xl">
          Learning Target
        </h3>
        <p className="present-card-body present-card-section-gap mt-3 text-base text-falcon-cream-200/80 sm:text-lg">
          {lesson.learningTarget || "No learning target set."}
        </p>
      </section>

      {hasMaterials && (
        <section
          data-span="wide"
          className="present-card flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7"
        >
          <h3 className="present-card-heading text-xl font-bold text-falcon-gold-300 sm:text-2xl">Materials</h3>
          <p className="present-card-body present-card-section-gap mt-3 text-base text-falcon-cream-200/80 sm:text-lg">
            {lesson.materials}
          </p>
        </section>
      )}

      <section
        data-span="half"
        className="present-card flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7"
      >
        <h3 className="present-card-heading text-xl font-bold text-falcon-gold-300 sm:text-2xl">Resources</h3>
        {lesson.resources.length === 0 ? (
          <p className="present-card-body present-card-section-gap mt-3 text-base text-falcon-cream-200/60">
            No resources linked.
          </p>
        ) : (
          <div className="present-card-section-gap mt-3 flex flex-col gap-2.5">
            {lesson.resources.map((resource) => (
              <a
                key={resource.id}
                href={resource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="present-card-body flex items-center justify-between rounded-lg bg-falcon-gold-400/90 px-4 py-3.5 text-base font-semibold text-falcon-brown-950 transition-colors hover:bg-falcon-gold-300"
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

      <section
        data-span="half"
        className="present-card flex min-h-[11rem] flex-col rounded-2xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-6 text-left sm:min-h-[13rem] sm:p-7"
      >
        <h3 className="present-card-heading text-xl font-bold text-falcon-gold-300 sm:text-2xl">
          Announcements
        </h3>
        {lesson.announcements.length === 0 ? (
          <p className="present-card-body present-card-section-gap mt-3 text-base text-falcon-cream-200/60">
            No announcements.
          </p>
        ) : (
          <ul className="present-card-section-gap mt-3 space-y-2">
            {lesson.announcements.map((note) => (
              <li key={note.id} className="present-card-body text-base text-falcon-cream-200/80">
                • {note.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
