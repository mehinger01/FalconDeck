import { redirect } from "next/navigation";
import { destinationForResolution, requireAuthenticatedUser, resolveActiveOrganization } from "@/lib/auth/dal";
import { deriveDataAuthorityState } from "@/lib/auth/dataAuthority";
import { CutoverAppDataProvider } from "@/lib/store/CutoverAppDataProvider";
import type { ReactNode } from "react";

/**
 * /present is now authenticated teacher Present Mode - the public
 * alternative is /demo/present (app/demo/present/page.tsx), untouched by
 * this change. Deliberately does NOT fall back to an anonymous/local
 * authority: once a teacher has migrated to cloud authority, an
 * expired/signed-out session must never resolve
 * anonymous -> localStorage -> /present. requireAuthenticatedUser()
 * redirects to /login instead, exactly like every other authenticated
 * route - anonymous visitors never reach deriveDataAuthorityState or
 * CutoverAppDataProvider at all.
 *
 * Reuses the exact same auth/DAL primitives as app/(app)/layout.tsx
 * (requireAuthenticatedUser, resolveActiveOrganization,
 * destinationForResolution, deriveDataAuthorityState) rather than
 * duplicating their logic - the only thing genuinely specific to this
 * layout is that it renders `children` directly, with none of (app)'s
 * NavBar/max-width/page-padding chrome, since Present is full-screen.
 *
 * This is a SIBLING route group to (app), not a child of it - route
 * groups can't opt a nested layout out of an ancestor's rendered chrome
 * (NavBar), so Present's authenticated-but-chrome-free requirement means
 * it can't live under (app) even though the auth/authority logic is
 * identical. Nested inside the root layout's own (localStorage-backed)
 * AppDataProvider, exactly like (app)/layout.tsx and
 * app/demo/layout.tsx's DemoAppDataProvider already are - see
 * app/(app)/layout.tsx's doc comment for the full nested-provider
 * analysis (same accepted, harmless cost: the outer provider's own
 * hydrate/save/subscribe cycle runs once, for data nothing under here
 * ever reads).
 */
export default async function PresentationLayout({ children }: { children: ReactNode }) {
  await requireAuthenticatedUser();
  const resolution = await resolveActiveOrganization();
  if (resolution.state !== "resolved") redirect(destinationForResolution(resolution));

  const authority = deriveDataAuthorityState(resolution);

  return <CutoverAppDataProvider authority={authority}>{children}</CutoverAppDataProvider>;
}
