import type { ScheduleValidationIssue } from "@/lib/schedule/validateSchedule";

export function ValidationBanner({ issues }: { issues: ScheduleValidationIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">This schedule has {issues.length} timing issue(s):</p>
      <ul className="mt-1 list-disc pl-5">
        {issues.map((issue, index) => (
          <li key={`${issue.blockId}-${issue.weekday}-${index}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}
