"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { path: "/schedule", label: "Bell Schedules" },
  { path: "/schedule/calendar", label: "Master Calendar" },
] as const;

/**
 * Shown atop both Schedule Setup areas so Master Calendar is never buried
 * inside general Settings. Prefixes links with `/demo` when rendered
 * under Demo Mode (detected from the current path) - otherwise Demo
 * Mode's Bell Schedules screen would link out into the real app's
 * Schedule Setup instead of staying inside the isolated demo session.
 */
export function ScheduleSectionTabs() {
  const pathname = usePathname();
  const prefix = pathname.startsWith("/demo") ? "/demo" : "";

  return (
    <div className="mb-6 flex gap-2 border-b border-falcon-brown-700/15">
      {TABS.map((tab) => {
        const href = `${prefix}${tab.path}`;
        const isActive = pathname === href;
        return (
          <Link
            key={tab.path}
            href={href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              isActive
                ? "border-falcon-gold-500 text-falcon-brown-900"
                : "border-transparent text-falcon-brown-700/60 hover:text-falcon-brown-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
