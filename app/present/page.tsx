import { Suspense } from "react";
import Link from "next/link";
import { PresentScreen } from "@/components/present/PresentScreen";
import { FalconErrorBoundary } from "@/components/FalconErrorBoundary";

function RestoringSchedule() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-falcon-brown-950 text-falcon-cream-200">
      Restoring today&apos;s classroom schedule…
    </div>
  );
}

export default function PresentPage() {
  return (
    <div className="relative min-h-screen">
      <FalconErrorBoundary>
        <Suspense fallback={<RestoringSchedule />}>
          <PresentScreen />
        </Suspense>
      </FalconErrorBoundary>
      <Link
        href="/schedule"
        className="absolute bottom-3 right-4 text-xs text-falcon-cream-200/20 transition-colors hover:text-falcon-cream-200/60"
      >
        Setup
      </Link>
    </div>
  );
}
