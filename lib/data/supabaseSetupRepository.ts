import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import {
  parseCompleteSetupResult,
  parseSaveSetupDraftResult,
  parseSetupState,
  type CompleteSetupResult,
  type SaveSetupDraftResult,
  type SetupCallResult,
  type SetupRepository,
  type SetupState,
} from "@/lib/onboarding/setupRepository";
import type { SetupDraft } from "@/types/setupDraft";

/**
 * The only shape of Supabase client this file needs: `rpc()`. Stated
 * structurally (rather than as SupabaseClient<Database>) for the same
 * reason lib/data/bellScheduleImportRpc.ts overlays its own RPC type -
 * lib/data/supabase.types.ts is generated, predates these functions, and is
 * never hand-edited. It also lets scripts/verify-onboarding-setup-db.ts run
 * this exact class against an isolated database.
 */
export interface SetupRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

const UNREADABLE_RESPONSE_MESSAGE = "Falcon Deck couldn't confirm that request. Check your connection and try again.";

/**
 * SetupRepository backed by the get_setup_state / save_setup_draft /
 * complete_setup RPCs (supabase/migrations/20261010210100_onboarding_setup_stage_b_rpcs.sql).
 * Sends only the organization id as context - the membership is resolved
 * server-side from the session, exactly like import_bell_schedule. Never
 * touches AppData, a DataRepository, or any operational table directly.
 */
export class SupabaseSetupRepository implements SetupRepository {
  private readonly client: SetupRpcClient;
  private readonly organizationId: string;

  constructor(client: SetupRpcClient, organizationId: string) {
    this.client = client;
    this.organizationId = organizationId;
  }

  getState(): Promise<SetupCallResult<SetupState>> {
    return this.call("get_setup_state", {}, parseSetupState);
  }

  saveDraft(expectedRevision: number | null, payload: SetupDraft): Promise<SetupCallResult<SaveSetupDraftResult>> {
    return this.call(
      "save_setup_draft",
      { p_expected_revision: expectedRevision, p_payload: payload },
      parseSaveSetupDraftResult,
    );
  }

  completeSetup(operationId: string, expectedRevision: number): Promise<SetupCallResult<CompleteSetupResult>> {
    return this.call(
      "complete_setup",
      { p_operation_id: operationId, p_expected_revision: expectedRevision },
      parseCompleteSetupResult,
    );
  }

  private async call<T>(
    name: string,
    args: Record<string, unknown>,
    parse: (value: unknown) => T | null,
  ): Promise<SetupCallResult<T>> {
    let response: { data: unknown; error: { message: string; code?: string } | null };
    try {
      response = await this.client.rpc(name, { p_organization_id: this.organizationId, ...args });
    } catch (error) {
      return { ok: false, kind: "unknown", message: error instanceof Error ? error.message : UNREADABLE_RESPONSE_MESSAGE };
    }

    if (response.error) {
      // An error that carries a code came back from Postgres/PostgREST: the
      // function raised, so its transaction rolled back and nothing was
      // applied. An error with no code is supabase-js reporting that the
      // request itself failed (e.g. the fetch threw) - the outcome is
      // unknown.
      return { ok: false, kind: response.error.code ? "rejected" : "unknown", message: response.error.message };
    }

    const value = parse(response.data);
    if (value === null) return { ok: false, kind: "unknown", message: UNREADABLE_RESPONSE_MESSAGE };
    return { ok: true, value };
  }
}

/** Browser-side factory - the same publishable-key client lib/store/selectDataRepository.ts already uses. */
export function createBrowserSetupRepository(organizationId: string): SetupRepository {
  return new SupabaseSetupRepository(createSupabaseBrowserClient() as unknown as SetupRpcClient, organizationId);
}
