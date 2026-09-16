import { redirect } from "next/navigation";
import { NavBar } from "@/components/layout/NavBar";
import { destinationForResolution, requireAuthenticatedUser, resolveActiveOrganization } from "@/lib/auth/dal";
import { deriveDataAuthorityState } from "@/lib/auth/dataAuthority";
import { CutoverAppDataProvider } from "@/lib/store/CutoverAppDataProvider";
import type { ReactNode } from "react";

/**
 * Every route under (app) requires both a signed-in user and a resolved
 * active organization (states A/B/D redirect away; only state C/resolved
 * renders here). /present and /demo are intentionally outside this group
 * and stay unauthenticated - see docs/CURRENT_STATE.md.
 *
 * This is the ONLY place CutoverAppDataProvider is mounted - the public
 * root layout (app/layout.tsx) deliberately stays auth-unaware and keeps
 * using the plain, local AppDataProvider for every route, this group
 * included. `resolution` is already guaranteed `{state: "resolved", ...}`
 * by the redirect above, so deriveDataAuthorityState is called directly on
 * it rather than re-resolving from scratch.
 *
 * NESTED PROVIDER TOPOLOGY (inspected, not assumed):
 * app/layout.tsx's AppDataProvider wraps every route, including this
 * group's children - there is no way to opt a nested layout out of an
 * ancestor layout's JSX in the App Router without splitting into separate
 * root layouts (a much larger restructuring, not done here). So mounting
 * CutoverAppDataProvider here means an authenticated page has TWO
 * AppDataProvider instances: the outer, root one (localStorage-backed,
 * inert) and this inner one (the actual authenticated context).
 * `useAppData()` always resolves to the *nearest* provider - exactly the
 * same shape app/demo/layout.tsx's DemoAppDataProvider already uses today -
 * so every authenticated screen reads/writes ONLY this inner context; the
 * outer context's `data` can never be mutated by anything under here,
 * because no authenticated action ever dispatches to it.
 *
 * Known, accepted cost of that shape (identical in kind to Demo Mode's
 * existing cost, not something new introduced here): the outer provider
 * still runs its own hydrate-on-mount, one-time resave-after-hydrate, and
 * cross-tab `storage`-event subscription, for a copy of localStorage data
 * nothing under here ever reads or displays. This is wasteful but provably
 * harmless - it cannot interfere with or overwrite authenticated app state,
 * since the two AppDataContext instances share no state and the outer
 * provider's `data` never changes after its own initial hydration. The
 * only way to eliminate it entirely is multiple root layouts (separate
 * `<html>/<body>` trees for authenticated vs. public routes) - a
 * significantly larger change; flagged for the user to decide on
 * separately rather than done here.
 */
export default async function AppSectionLayout({ children }: { children: ReactNode }) {
  await requireAuthenticatedUser();
  const resolution = await resolveActiveOrganization();
  if (resolution.state !== "resolved") redirect(destinationForResolution(resolution));

  const authority = deriveDataAuthorityState(resolution);

  return (
    <CutoverAppDataProvider authority={authority}>
      <div className="flex min-h-full flex-1 flex-col bg-falcon-cream-200 text-falcon-brown-900">
        <NavBar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </div>
    </CutoverAppDataProvider>
  );
}
