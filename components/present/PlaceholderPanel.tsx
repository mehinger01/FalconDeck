export function PlaceholderPanel({ title, note }: { title: string; note: string }) {
  return (
    <section className="flex min-h-[9rem] flex-col rounded-xl border border-falcon-gold-500/30 bg-falcon-cream-100/5 p-5">
      <h3 className="text-lg font-bold text-falcon-gold-300">{title}</h3>
      <p className="mt-2 text-sm text-falcon-cream-200/60">{note}</p>
    </section>
  );
}
