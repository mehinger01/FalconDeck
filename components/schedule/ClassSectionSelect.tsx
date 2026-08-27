"use client";

import { useAppData } from "@/lib/store/AppDataProvider";
import { resolveCourseForSection } from "@/lib/data/resolve";
import type { ClassSection } from "@/types/course";

export function ClassSectionSelect({
  value,
  onChange,
  id,
  sections,
}: {
  value: string | null | undefined;
  onChange: (classSectionId: string | null) => void;
  id?: string;
  sections?: ClassSection[];
}) {
  const { data } = useAppData();
  const options = sections ?? data.classSections;

  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      className="w-full rounded-md border border-falcon-brown-700/30 bg-white px-2 py-1.5 text-sm text-falcon-brown-900"
    >
      <option value="">— None —</option>
      {options.map((section) => {
        const course = resolveCourseForSection(data.courses, section);
        return (
          <option key={section.id} value={section.id}>
            {section.name}
            {course ? ` (${course.name})` : ""}
          </option>
        );
      })}
    </select>
  );
}
