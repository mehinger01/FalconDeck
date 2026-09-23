"use client";

import { useMemo, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/lib/store/AppDataProvider";
import { buildLocalDataBackup, triggerBrowserDownload } from "@/lib/data/migration/downloadBackup";
import { migrateLocalData, markMigrationComplete } from "@/lib/data/migration/migrateLocalData";
import { validateMigratedData } from "@/lib/data/migration/validateMigratedData";
import { createSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import {
  INITIAL_MIGRATION_UI_STATE,
  MIGRATION_ACTION_ENABLED,
  migrationUiReducer,
} from "@/lib/data/migration/migrationUiState";

/**
 * PHASE B: the real, production migration flow. Required order (see the
 * Phase B milestone report): download backup -> explicit "Migrate to
 * cloud" click -> migrateLocalData -> validateMigratedData -> ONLY on
 * validation success, markMigrationComplete -> router.refresh().
 *
 * That refresh is deliberate, not a hot-swap: (app)/(presentation)'s
 * layout re-resolves DataAuthorityState server-side, which now reads
 * local_data_migrated_at as set - CutoverAppDataProvider's mount key
 * changes from "local:<id>" to "cloud-ready:<id>", so React remounts
 * AppDataProvider fresh (a real SupabaseDataRepository, blockUntilHydrated)
 * rather than swapping the repository under an already-hydrated instance.
 *
 * Every failure path (migration, validation, or marking complete) leaves
 * local_data_migrated_at null, never calls router.refresh(), and never
 * touches localStorage - the user stays on the local repository and can
 * retry freely, per the milestone's "never partially flip runtime
 * authority" requirement.
 */
export function MigrationSetupCard({
  migrationPending,
  organizationId,
  membershipId,
}: {
  /**
   * True only when this membership's authority is "local" - i.e. legacy
   * migration both applies to this account AND hasn't completed yet (see
   * lib/auth/dataAuthority.ts). Deliberately not a migratedAt timestamp:
   * a cloud-native account also has no migratedAt value, but migration
   * never applies to it, so gating on "migratedAt === null" alone would
   * wrongly show this card for one. This flag encodes applicability, not
   * just completion.
   */
  migrationPending: boolean;
  organizationId: string;
  membershipId: string;
}) {
  const { data } = useAppData();
  const [state, dispatch] = useReducer(migrationUiReducer, INITIAL_MIGRATION_UI_STATE);
  // Deliberately separate from `state` above: whether a backup was
  // downloaded is a durable fact for this visit, never cleared by RESET -
  // a failed migration attempt (which does reset `state` back to
  // "not-started" so the user can retry) must not also force them to
  // re-download a backup they already have.
  const [hasDownloadedBackup, setHasDownloadedBackup] = useState(false);
  const router = useRouter();
  // One client for this card's lifetime - migration is a single user-driven
  // action, not something that needs to survive a repository remount.
  const client = useMemo(() => createSupabaseBrowserClient(), []);

  // Migration inapplicable (cloud-native) or already complete - no prompt
  // at all, not even a dismissed/collapsed one.
  if (!migrationPending) return null;

  const handleDownloadBackup = () => {
    triggerBrowserDownload(buildLocalDataBackup(data));
    setHasDownloadedBackup(true);
    dispatch({ type: "BACKUP_DOWNLOADED" });
  };

  const handleMigrate = async () => {
    dispatch({ type: "MIGRATE_START" });
    const ctx = { organizationId, membershipId };
    try {
      // `data` is the exact in-memory snapshot the backup was just built
      // from - never a fresh localStorage re-read, so there is no gap
      // between "what was backed up" and "what gets migrated."
      const migrationResult = await migrateLocalData(client, ctx, data);
      if (!migrationResult.ok) {
        if (migrationResult.alreadyMigrated) {
          // Raced with another tab/device migrating this same membership -
          // it IS migrated now, just not by this click. Refresh to pick up
          // the real state rather than reporting a scary "failed."
          router.refresh();
          return;
        }
        dispatch({
          type: "MIGRATE_FAILURE",
          message: `Migration failed: ${migrationResult.error} Your local data is untouched - safe to try again.`,
        });
        return;
      }

      const validation = await validateMigratedData(client, ctx, data, migrationResult);
      if (!validation.ok) {
        dispatch({
          type: "MIGRATE_FAILURE",
          message:
            "Migration ran, but the cloud data doesn't match your local data yet, so nothing was marked complete. " +
            "Your local data is untouched - safe to try again.",
        });
        return;
      }

      await markMigrationComplete(client, membershipId);
      dispatch({ type: "MIGRATE_SUCCESS" });
      router.refresh();
    } catch (error) {
      dispatch({
        type: "MIGRATE_FAILURE",
        message:
          (error instanceof Error ? `Something went wrong: ${error.message}.` : "Something went wrong.") +
          " Your local data is untouched - safe to try again.",
      });
    }
  };

  const migrating = state.step === "migrating";

  return (
    <div
      data-testid="migration-setup-card"
      className="mb-6 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-4"
    >
      <h2 className="font-semibold text-falcon-brown-900">Move your data to the cloud</h2>
      <p className="mt-1 text-sm text-falcon-brown-700/70">
        Sign in on another device afterward and see the same classes, schedule, and lessons. Your local data on this
        browser stays exactly as it is - nothing below deletes or changes it.
      </p>

      <ol className="mt-4 space-y-3 text-sm">
        <li>
          <button
            type="button"
            onClick={handleDownloadBackup}
            className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20"
          >
            Download a backup of your current data
          </button>
          {hasDownloadedBackup && <span className="ml-2 text-xs font-semibold text-falcon-brown-700/70">Downloaded.</span>}
        </li>
        <li>
          <button
            type="button"
            onClick={handleMigrate}
            disabled={!MIGRATION_ACTION_ENABLED || !hasDownloadedBackup || migrating}
            title={!hasDownloadedBackup ? "Download a backup first." : undefined}
            className="rounded-md bg-falcon-brown-900 px-3 py-1.5 font-semibold text-falcon-cream-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {migrating ? "Migrating…" : "Migrate to cloud"}
          </button>
          {!hasDownloadedBackup && (
            <p className="mt-1 text-xs text-falcon-brown-700/60">Download a backup first to enable this.</p>
          )}
        </li>
      </ol>

      {state.step === "success" && (
        <p className="mt-3 text-sm font-semibold text-falcon-brown-900">Done - your data is now synced.</p>
      )}
      {state.step === "error" && (
        <div className="mt-3 rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
          <p>{state.message}</p>
          <button type="button" onClick={() => dispatch({ type: "RESET" })} className="mt-1 font-semibold underline">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
