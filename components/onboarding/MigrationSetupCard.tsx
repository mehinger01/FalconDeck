"use client";

import { useReducer } from "react";
import { useAppData } from "@/lib/store/AppDataProvider";
import { buildLocalDataBackup, triggerBrowserDownload } from "@/lib/data/migration/downloadBackup";
import {
  INITIAL_MIGRATION_UI_STATE,
  MIGRATION_ACTION_ENABLED,
  migrationUiReducer,
} from "@/lib/data/migration/migrationUiState";

/**
 * PHASE A: UX/state plumbing only. The backup download is real (it never
 * mutates either repository); the "Migrate to cloud" action is disabled -
 * see migrationUiState.ts's MIGRATION_ACTION_ENABLED, the single flag Phase
 * B flips. Nothing here calls migrateLocalData/validateMigratedData/
 * markMigrationComplete yet.
 */
export function MigrationSetupCard({ migratedAt }: { migratedAt: string | null }) {
  const { data } = useAppData();
  const [state, dispatch] = useReducer(migrationUiReducer, INITIAL_MIGRATION_UI_STATE);

  // Already migrated - no prompt at all, not even a dismissed/collapsed one.
  if (migratedAt !== null) return null;

  const handleDownloadBackup = () => {
    triggerBrowserDownload(buildLocalDataBackup(data));
    dispatch({ type: "BACKUP_DOWNLOADED" });
  };

  return (
    <div
      data-testid="migration-setup-card"
      className="mb-6 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-4"
    >
      <h2 className="font-semibold text-falcon-brown-900">Move your data to the cloud</h2>
      <p className="mt-1 text-sm text-falcon-brown-700/70">
        Once cloud sync is turned on for your account, signing in on another device will show the same classes,
        schedule, and lessons. Your local data on this browser stays exactly as it is - nothing below deletes or
        changes it.
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
          {state.step === "backup-downloaded" && (
            <span className="ml-2 text-xs font-semibold text-falcon-brown-700/70">Downloaded.</span>
          )}
        </li>
        <li>
          <button
            type="button"
            disabled={!MIGRATION_ACTION_ENABLED}
            title={!MIGRATION_ACTION_ENABLED ? "Cloud migration isn't turned on yet in this build." : undefined}
            className="rounded-md bg-falcon-brown-900 px-3 py-1.5 font-semibold text-falcon-cream-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Migrate to cloud
          </button>
          {!MIGRATION_ACTION_ENABLED && (
            <p className="mt-1 text-xs text-falcon-brown-700/60">
              Not yet available - this is a preview of the setup flow ahead of cloud sync turning on.
            </p>
          )}
        </li>
      </ol>

      {state.step === "migrating" && <p className="mt-3 text-sm text-falcon-brown-700">Migrating…</p>}
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
