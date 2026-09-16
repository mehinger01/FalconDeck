import { dataRepository } from "@/lib/data/localStorageRepository";
import type { DataRepository } from "@/lib/data/types";
import type { DataAuthorityState } from "@/lib/auth/dataAuthority";

export interface DataAuthorityRepositoryPolicy {
  repository: DataRepository;
  /** See AppDataProvider's `blockUntilHydrated` prop doc comment. */
  blockUntilHydrated: boolean;
}

/**
 * PHASE A: every authority kind - including "cloud-ready" - resolves to the
 * local repository with blocking hydration OFF. No authenticated user
 * starts using SupabaseDataRepository, or a hydration policy that assumes
 * one, from the running app during Phase A.
 *
 * This function's `"cloud-ready"` branch is the single, deliberately
 * isolated place Phase B changes to begin real cutover: constructing a
 * SupabaseDataRepository (from createSupabaseBrowserClient() + the
 * authority's organizationId/membershipId) AND setting
 * `blockUntilHydrated: true` together, in the same edit, so a migrated
 * user's app can never render demo/seed data as if it were their real
 * cloud data while load() is pending. Nothing else in the provider/store
 * layer needs to change for that - AppDataProvider itself never inspects
 * `authority` or the repository's class, only the plain `blockUntilHydrated`
 * boolean this function hands it.
 */
export function selectDataRepositoryPolicy(authority: DataAuthorityState): DataAuthorityRepositoryPolicy {
  switch (authority.kind) {
    case "anonymous":
    case "no-membership":
    case "needs-selection":
    case "local":
      return { repository: dataRepository, blockUntilHydrated: false };
    case "cloud-ready":
      // PHASE A: intentionally still local + non-blocking - see module doc
      // comment above for exactly what Phase B changes here.
      return { repository: dataRepository, blockUntilHydrated: false };
  }
}
