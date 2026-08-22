"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const DEMO_NAV_LINKS = [
  { href: "/demo", label: "Demo Home" },
  { href: "/demo/present", label: "Classroom Display" },
  { href: "/demo/week", label: "Weekly Plan" },
  { href: "/demo/schedule", label: "Bell Schedules" },
  { href: "/demo/schedule/calendar", label: "Master Calendar" },
  { href: "/demo/resources", label: "Resource Library" },
] as const;

/**
 * Demo Mode's chrome: a persistent-but-unobtrusive "Demo Mode" badge and
 * an always-reachable "Exit Demo" (a plain navigation back into the real
 * app - `/demo` unmounting is all "exiting" requires, since
 * DemoAppDataProvider's isolated repository instance simply goes away).
 * The Classroom Display route renders its own minimal full-screen badge
 * instead (see DemoPresentSimulator) to match real Present Mode's
 * chrome-free design - this header is hidden there.
 */
export function DemoShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPresent = pathname === "/demo/present";

  if (isPresent) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-falcon-cream-200 text-falcon-brown-900">
      <header className="border-b border-falcon-brown-800/10 bg-falcon-cream-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/demo" className="text-xl font-bold tracking-tight text-falcon-brown-900">
              Falcon Deck
            </Link>
            <span className="rounded-full bg-falcon-gold-500 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-falcon-brown-950">
              Demo Mode
            </span>
          </div>
          <nav className="flex flex-wrap gap-1">
            {DEMO_NAV_LINKS.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-falcon-brown-900 text-falcon-cream-100"
                      : "text-falcon-brown-800 hover:bg-falcon-gold-300/40"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <Link
            href="/"
            className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 text-sm font-semibold text-falcon-brown-700 hover:bg-white"
          >
            Exit Demo
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
