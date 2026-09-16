"use client";

import type { ReactNode } from "react";
import { AppDataProvider } from "./AppDataProvider";
import { selectDataRepositoryPolicy } from "./selectDataRepository";
import { dataAuthorityMountKey, type DataAuthorityState } from "@/lib/auth/dataAuthority";

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

  const { repository, blockUntilHydrated } = selectDataRepositoryPolicy(authority);

  return (
    <AppDataProvider
      key={dataAuthorityMountKey(authority)}
      repository={repository}
      blockUntilHydrated={blockUntilHydrated}
    >
      {children}
    </AppDataProvider>
  );
}
