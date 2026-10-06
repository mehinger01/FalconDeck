import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlockKind } from "@/types/schedule";
import type { Database } from "./supabase.types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";

/**
 * Stage E (Bell Schedule CSV Import) - the sole client-side entry point to
 * the atomic public.import_bell_schedule RPC (see
 * supabase/migrations/20261003195952_bell_schedule_csv_import_stage_e_rpc.sql).
 * This is strictly the RPC boundary: it calls the function, defensively
 * validates just enough of the response to know the import actually
 * succeeded, and returns a typed result. It never touches AppData, never
 * dispatches a reducer action, never calls repository.save()/applyDiff,
 * never mutates a repository's lastSnapshot, and never activates the
 * imported schedule - by design, the caller is expected to hard-reload on
 * success so the ordinary SupabaseDataRepository.load()/fetchAppData() path
 * becomes authoritative again (see the Stage E client design review) rather
 * than this helper trying to locally reconstruct a BellSchedule.
 */

/**
 * Narrow, local-only type overlay for the import_bell_schedule RPC.
 * lib/data/supabase.types.ts (generated) predates this migration and has no
 * entry for it - this repo has no established deterministic/read-only
 * type-generation process to regenerate that file from, so it is never
 * hand-edited here. This overlay is scoped to exactly this one function and
 * does not widen or touch the real Database type anywhere else; `Returns:
 * unknown` is deliberate - the response is validated by hand below rather
 * than trusted via a generated shape.
 */
type ImportBellScheduleRpcArgs = {
  p_organization_id: string;
  p_id: string;
  p_name: string;
  p_blocks: Array<{
    id: string;
    label: string;
    kind: BlockKind;
    start_time: string;
    end_time: string;
  }>;
  p_time_zone: string;
};

type ImportBellScheduleDatabase = Database & {
  public: Database["public"] & {
    Functions: Database["public"]["Functions"] & {
      import_bell_schedule: {
        Args: ImportBellScheduleRpcArgs;
        Returns: unknown;
      };
    };
  };
};

export interface ImportBellScheduleBlockInput {
  id: string;
  label: string;
  kind: BlockKind;
  /** 24h "HH:mm" */
  startTime: string;
  /** 24h "HH:mm" */
  endTime: string;
}

export type ImportBellScheduleResult =
  | { ok: true; scheduleId: string; scheduleName: string }
  | { ok: false; message: string };

const CONFIRMATION_FAILURE_MESSAGE = "Falcon Deck couldn't confirm the imported schedule. Please try again.";

export async function importBellSchedule(input: {
  organizationId: string;
  scheduleId: string;
  name: string;
  timeZone: string;
  blocks: ImportBellScheduleBlockInput[];
}): Promise<ImportBellScheduleResult> {
  // createSupabaseBrowserClient() is the existing, already-in-use browser
  // client convention (see lib/store/selectDataRepository.ts) - the cast
  // here applies only the narrow overlay above, for this one call; it does
  // not change what the function itself returns or affect any other caller.
  const client = createSupabaseBrowserClient() as SupabaseClient<ImportBellScheduleDatabase>;

  const { data, error } = await client.rpc("import_bell_schedule", {
    p_organization_id: input.organizationId,
    p_id: input.scheduleId,
    p_name: input.name,
    p_blocks: input.blocks.map((block) => ({
      id: block.id,
      label: block.label,
      kind: block.kind,
      start_time: block.startTime,
      end_time: block.endTime,
    })),
    p_time_zone: input.timeZone,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  // Minimal, defensive validation of exactly what this helper's caller
  // needs - never a full BellSchedule reconstruction (see module doc
  // comment). `data` is `unknown` per the overlay above, so every step here
  // is a real narrowing check, not a trusted cast.
  if (typeof data !== "object" || data === null) {
    return { ok: false, message: CONFIRMATION_FAILURE_MESSAGE };
  }

  const responseSchedule = (data as { schedule?: unknown }).schedule;
  const responseBlocks = (data as { blocks?: unknown }).blocks;

  if (typeof responseSchedule !== "object" || responseSchedule === null) {
    return { ok: false, message: CONFIRMATION_FAILURE_MESSAGE };
  }

  const scheduleId = (responseSchedule as { id?: unknown }).id;
  const scheduleName = (responseSchedule as { name?: unknown }).name;

  if (
    typeof scheduleId !== "string" ||
    scheduleId.trim().length === 0 ||
    typeof scheduleName !== "string" ||
    !Array.isArray(responseBlocks)
  ) {
    return { ok: false, message: CONFIRMATION_FAILURE_MESSAGE };
  }

  return { ok: true, scheduleId, scheduleName };
}
