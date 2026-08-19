"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/present", label: "Present" },
  { href: "/week", label: "Week" },
  { href: "/lessons", label: "Lessons" },
  { href: "/schedule", label: "Schedule Setup" },
  { href: "/classes", label: "Classes" },
  { href: "/settings", label: "Settings" },
] as const;

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-falcon-brown-800/10 bg-falcon-cream-100">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/present" className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight text-falcon-brown-900">
            Falcon Deck
          </span>
          <span className="text-xs font-medium uppercase tracking-widest text-falcon-gold-600">
            Ogemaw Heights Falcons
          </span>
        </Link>
        <nav className="flex gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
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
      </div>
    </header>
  );
}
