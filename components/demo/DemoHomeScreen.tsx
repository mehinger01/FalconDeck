import Link from "next/link";

const SECONDARY_CARDS = [
  { href: "/demo/week", label: "Weekly Plan", description: "See the Monday-Friday planning grid, calendar badges and all." },
  { href: "/demo/schedule", label: "Bell Schedules", description: "The real OHHS Regular Day preset, plus sample special schedules." },
  { href: "/demo/schedule/calendar", label: "Master Calendar", description: "The real OHHS 2026-27 exceptions, imported and ready." },
  { href: "/demo/resources", label: "Resource Library", description: "A seeded set of favorites, tags, and reusable links." },
  { href: "/demo/present", label: "Classroom Tools", description: "Timer, Clean Screen, Quick Resource, and QR - all live in Present." },
] as const;

export function DemoHomeScreen() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-falcon-brown-900">Falcon Deck Demo</h1>
        <p className="mt-2 text-lg text-falcon-brown-700/70">See how a fully configured classroom runs.</p>
        <p className="mt-1 text-sm text-falcon-brown-700/60">
          Everything here is disposable sample data in an isolated demo session - nothing you do affects
          your real Falcon Deck setup.
        </p>
      </div>

      <Link
        href="/demo/present"
        className="mb-6 block rounded-xl bg-falcon-brown-900 px-6 py-5 text-center text-lg font-bold uppercase tracking-wide text-falcon-cream-100 transition-colors hover:bg-falcon-brown-800"
      >
        Open Classroom Display
      </Link>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECONDARY_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-falcon-brown-700/15 bg-white/60 p-4 transition-colors hover:bg-white"
          >
            <p className="font-semibold text-falcon-brown-900">{card.label}</p>
            <p className="mt-1 text-xs text-falcon-brown-700/60">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
