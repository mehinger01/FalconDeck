/**
 * The Master Calendar says students don't attend at all today (a holiday,
 * a break) - no lesson boxes, no next class, no countdown, no transition.
 * Distinct from NoStudentsScreen: "no school" means the building is
 * closed to everyone, not just students.
 */
export function NoSchoolScreen({ title }: { title?: string }) {
  return (
    <div className="animate-present-fade flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <h1 className="text-6xl font-black text-falcon-cream-100 sm:text-7xl">NO SCHOOL</h1>
      {title && <p className="text-lg text-falcon-cream-200/70">{title}</p>}
    </div>
  );
}
