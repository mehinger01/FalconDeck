import type { DataAuthorityState } from "@/lib/auth/dataAuthority";
import { deriveSetupEntry, type SetupEntry } from "./setupEntry";
import type { SetupState } from "./setupRepository";

/**
 * Server-side switch for the guided-setup UI (docs/ONBOARDING_SETUP_ARCHITECTURE.md).
 *
 * Off unless `FALCON_GUIDED_SETUP` is exactly "on", and always off in a
 * Vercel production deployment - so guided setup can be tried in Preview
 * (against the staging Supabase project) without any chance of reaching
 * real teachers, even if the variable were set for Production by mistake.
 *
 * Read only on the server: it is not a NEXT_PUBLIC_ variable, so it is never
 * shipped to the browser and cannot be flipped there.
 */
export function isGuidedSetupEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return env.FALCON_GUIDED_SETUP === "on";
}

/**
 * The entry decision with the switch applied: with guided setup off, every
 * account gets the existing app; with it on, the existing rule
 * (deriveSetupEntry) decides - so established, legacy and unreadable
 * accounts still get the existing app.
 */
export function guidedSetupEntry(enabled: boolean, authority: DataAuthorityState, setupState: SetupState | null): SetupEntry {
  return enabled ? deriveSetupEntry(authority, setupState) : "existing-app";
}
