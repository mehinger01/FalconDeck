/**
 * The Master Calendar says the building is open for staff but students
 * don't attend today (PD, a teacher work day) - calm and teacher-facing,
 * distinct from NoSchoolScreen ("no school" for everyone).
 */
export function NoStudentsScreen({ title }: { title?: string }) {
  return (
    <div className="animate-present-fade flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <h1 className="text-6xl font-black text-falcon-cream-100 sm:text-7xl">NO STUDENTS</h1>
      {title && <p className="text-lg text-falcon-cream-200/70">{title}</p>}
    </div>
  );
}
