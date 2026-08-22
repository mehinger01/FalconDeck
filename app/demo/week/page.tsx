import { Suspense } from "react";
import { WeekScreen } from "@/components/week/WeekScreen";

export default function DemoWeekPage() {
  return (
    <Suspense fallback={null}>
      <WeekScreen />
    </Suspense>
  );
}
