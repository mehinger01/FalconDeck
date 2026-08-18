import Link from "next/link";
import { PresentScreen } from "@/components/present/PresentScreen";

export default function PresentPage() {
  return (
    <div className="relative min-h-screen">
      <PresentScreen />
      <Link
        href="/schedule"
        className="absolute bottom-3 right-4 text-xs text-falcon-cream-200/20 transition-colors hover:text-falcon-cream-200/60"
      >
        Setup
      </Link>
    </div>
  );
}
