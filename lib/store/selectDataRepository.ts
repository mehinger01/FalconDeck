import { dataRepository } from "@/lib/data/localStorageRepository";
import { SupabaseDataRepository } from "@/lib/data/supabaseDataRepository";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import type { DataRepository } from "@/lib/data/types";
import type { DataAuthorityState } from "@/lib/auth/dataAuthority";

export interface DataAuthorityRepositoryPolicy {
  repository: DataRepository;
  /** See AppDataProvider's `blockUntilHydrated` prop doc comment. */
  blockUntilHydrated: boolean;
}

/**
 * PHASE B: every authority kind resolves to the local repository EXCEPT
 * "cloud-ready", which now constructs a real SupabaseDataRepository -
 * createSupabaseBrowserClient() uses only the public publishable key
 * (@supabase/ssr's ordinary browser client; no service-role/secret key
 * ever reaches the browser) - and sets `blockUntilHydrated: true`, so a
 * migrated user's app can never render demo/seed data as if it were their
 * real cloud data while load() is pending.
 *
 * No fallback to `dataRepository` exists anywhere in this branch: a
 * cloud-ready user who fails to load gets AppDataProvider's blocking
 * error/session-ended UI, never a silent switch to local storage.
 *
 * AppDataProvider itself never inspects `authority` or the repository's
 * class, only the plain `blockUntilHydrated` boolean this function hands
 * it - see its own doc comment.
 */
export function selectDataRepositoryPolicy(authority: DataAuthorityState): DataAuthorityRepositoryPolicy {
  switch (authority.kind) {
    case "anonymous":
    case "no-membership":
    case "needs-selection":
    case "local":
      return { repository: dataRepository, blockUntilHydrated: false };
    case "cloud-ready":
      return {
        repository: new SupabaseDataRepository(createSupabaseBrowserClient(), {
          organizationId: authority.organizationId,
          membershipId: authority.membershipId,
        }),
        blockUntilHydrated: true,
      };
  }
}
