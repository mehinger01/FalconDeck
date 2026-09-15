import { redirect } from "next/navigation";
import { NavBar } from "@/components/layout/NavBar";
import { destinationForResolution, requireAuthenticatedUser, resolveActiveOrganization } from "@/lib/auth/dal";
import type { ReactNode } from "react";

/**
 * Every route under (app) requires both a signed-in user and a resolved
 * active organization (states A/B/D redirect away; only state C/resolved
 * renders here). /present and /demo are intentionally outside this group
 * and stay unauthenticated - see docs/CURRENT_STATE.md.
 */
export default async function AppSectionLayout({ children }: { children: ReactNode }) {
  await requireAuthenticatedUser();
  const resolution = await resolveActiveOrganization();
  if (resolution.state !== "resolved") redirect(destinationForResolution(resolution));

  return (
    <div className="flex min-h-full flex-1 flex-col bg-falcon-cream-200 text-falcon-brown-900">
      <NavBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
