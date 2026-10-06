"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { ActiveScheduleGate } from "./ActiveScheduleGate";
import { AppDataProvider } from "./AppDataProvider";
import { selectDataRepositoryPolicy } from "./selectDataRepository";
import { dataAuthorityMountKey, type DataAuthorityState } from "@/lib/auth/dataAuthority";

/**
 * The current organization id, available to client components ONLY when the
 * resolved authority is "cloud-ready" (a real SupabaseDataRepository is
 * active) - `null` for anonymous/no-membership/needs-selection/"local"
 * (pre-migration, still LocalStorageDataRepository-backed even though it
 * does carry a real organizationId - see DataAuthorityState) and for Demo
 * Mode (no CutoverAppDataProvider mounted there at all, so this resolves to
 * the plain default below). Purpose-built for Stage E's Bell Schedule CSV
 * Import, which needs to know "is it safe to call a Supabase RPC that
 * writes directly to the cloud" - never broadened into a generic auth/role/
 * membership context. See useCurrentOrganizationId's own doc comment.
 */
const OrganizationIdContext = createContext<string | null>(null);

/**
 * `null` means either no CutoverAppDataProvider is mounted (Demo Mode,
 * Present Mode outside its own authenticated layout, etc.) or the resolved
 * authority is anything other than "cloud-ready" - callers must treat both
 * cases identically: whatever Supabase-only feature this gates must not
 * render/run. Never attempt to fall back to a different authority's
 * organizationId (e.g. "local"'s) - that would defeat the reason this
 * exists (see the context's own doc comment).
 */
export function useCurrentOrganizationId(): string | null {
  return useContext(OrganizationIdContext);
}

/**
 * The only place AppDataProvider's `repository`/`blockUntilHydrated` props
 * are decided from auth state - AppDataProvider itself stays fully unaware
 * of auth/org concepts and never inspects the repository's class; it only
 * ever sees a DataRepository plus an explicit boolean (see
 * selectDataRepository.ts for the Phase A -> Phase B branch this owns).
 *
 * Mounted only inside app/(app)/layout.tsx, the authenticated route group -
 * not the public root layout. `authority` is resolved server-side there
 * (deriveDataAuthorityState, from a resolution that layout already
 * required to be "resolved") and passed in as a plain prop - never a
 * Supabase client or session object.
 *
 * This is nested INSIDE the root layout's own (localStorage-backed)
 * AppDataProvider, exactly like app/demo/layout.tsx's DemoAppDataProvider
 * already is - useAppData() always resolves to the *nearest* provider, so
 * every authenticated screen reads/writes only this inner context, never
 * the outer root one. See app/(app)/layout.tsx's doc comment for the full
 * nested-provider analysis (including the one accepted, harmless cost:
 * the outer provider still runs its own hydrate/save/subscribe cycle once,
 * for a copy of the data nothing under here ever reads).
 *
 * Keying the inner AppDataProvider on `dataAuthorityMountKey(authority)`
 * guarantees a fresh mount - and therefore a fresh hydration - any time the
 * resolved authority changes identity (sign-in, sign-out, switching
 * organizations, choosing between memberships, or a future migration
 * completing). AppDataProvider's own hydration effect is deliberately
 * mount-only ("a provider is never expected to swap its repository/seedData
 * after first render"); a `key` change is what makes a local -> cloud-ready
 * transition a remount instead of a prop swap into an already-hydrated
 * instance.
 */
export function CutoverAppDataProvider({ authority, children }: { authority: DataAuthorityState; children: ReactNode }) {
  if (process.env.NODE_ENV !== "production") {
    // Dev-only visibility into which authority state the server resolved -
    // not rendered UI, never shipped to production. See the Phase A audit's
    // "migration status visibility" requirement.
    console.debug("[CutoverAppDataProvider] resolved authority:", authority);
  }

  const mountKey = dataAuthorityMountKey(authority);

  // Memoized on `mountKey` (the authority's semantic identity), not on the
  // `authority` object reference. Next.js re-invokes this component's
  // Server Component ancestors - handing this component a brand-new
  // `authority` object - on every navigation within an authenticated route
  // group, even between two pages where nothing about the signed-in user
  // actually changed. Without this memoization, a cloud-ready user would
  // get a brand-new SupabaseDataRepository (and browser client) on every
  // navigation, forcing a full reload - and, since blockUntilHydrated is
  // true for cloud-ready, a visible loading flash - between every page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { repository, blockUntilHydrated } = useMemo(() => selectDataRepositoryPolicy(authority), [mountKey]);

  return (
    <AppDataProvider key={mountKey} repository={repository} blockUntilHydrated={blockUntilHydrated}>
      {/* Stage F: mounted here (not in each route group's own layout) so
          every consumer of CutoverAppDataProvider - (app)/layout.tsx AND
          (presentation)/present/layout.tsx alike - gets the active-schedule
          gate for free, from one place, using this same already-resolved
          AppData context. `enabled` is authority.kind === "cloud-ready" -
          a migration-pending "local"-authority account must never be
          gated (bare /setup has to stay reachable for MigrationSetupCard);
          see ActiveScheduleGate.tsx's own doc comment for the cutover-audit
          bug this fixes. */}
      <OrganizationIdContext.Provider value={authority.kind === "cloud-ready" ? authority.organizationId : null}>
        <ActiveScheduleGate enabled={authority.kind === "cloud-ready"}>{children}</ActiveScheduleGate>
      </OrganizationIdContext.Provider>
    </AppDataProvider>
  );
}
