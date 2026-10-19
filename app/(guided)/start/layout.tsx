import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { destinationForResolution, requireAuthenticatedUser, resolveActiveOrganization } from "@/lib/auth/dal";

/**
 * The guided-setup shell. Deliberately OUTSIDE the (app) route group: no
 * CutoverAppDataProvider, no NavBar, no operational autosave - the flow
 * writes only through SetupRepository (docs/ONBOARDING_SETUP_ARCHITECTURE.md
 * §9.1). Same sign-in and school-resolution gate as (app)/layout.tsx: a
 * signed-out user goes to /login, a user without a resolved school to
 * /onboarding.
 */
export default async function GuidedSetupLayout({ children }: { children: ReactNode }) {
  await requireAuthenticatedUser();
  const resolution = await resolveActiveOrganization();
  if (resolution.state !== "resolved") redirect(destinationForResolution(resolution));

  return <div className="flex min-h-full flex-1 flex-col bg-falcon-cream-200 text-falcon-brown-900">{children}</div>;
}
