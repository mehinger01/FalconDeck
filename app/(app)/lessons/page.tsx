import { Suspense } from "react";
import { LessonsScreen } from "@/components/lessons/LessonsScreen";

export default function LessonsPage() {
  return (
    <Suspense fallback={null}>
      <LessonsScreen />
    </Suspense>
  );
}
