"use client";

import { useReducer, useRef } from "react";
import { parseBackup, restoreBackupToLocal } from "@/lib/data/migration/restoreBackup";
import { INITIAL_RESTORE_UI_STATE, restoreUiReducer } from "@/lib/data/migration/restoreUiState";

/**
 * Recovery path for a downloaded Falcon Deck backup - the read half of
 * MigrationSetupCard's write-only backup download. Deliberately narrow:
 * restore ALWAYS targets LocalStorageDataRepository only (see
 * restoreBackup.ts's own doc comment) - it is never offered when the
 * current authority is "cloud-ready", so there is no path here that could
 * ever construct a Supabase client, touch cloud data, or fall back to
 * localStorage as an alternate runtime authority for a migrated account.
 *
 * Selecting a file only parses/validates it and shows a preview - nothing
 * is written to localStorage until the user explicitly confirms via the
 * red "Restore this backup" button (window.confirm, matching
 * SettingsScreen's existing "Reset to Demo Data" destructive-action
 * pattern - no new modal framework).
 */
export function RestoreBackupCard({ authorityKind }: { authorityKind: "local" | "cloud-ready" }) {
  const [state, dispatch] = useReducer(restoreUiReducer, INITIAL_RESTORE_UI_STATE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (authorityKind === "cloud-ready") {
    return (
      <div className="mb-6 rounded-lg border border-falcon-brown-700/15 bg-white/40 p-4">
        <h2 className="font-semibold text-falcon-brown-900">Restore from a Falcon Deck backup</h2>
        <p className="mt-1 text-sm text-falcon-brown-700/70">
          This account is already using cloud data. Local backup restore is unavailable here.
        </p>
      </div>
    );
  }

  const resetFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChosen = async (file: File) => {
    const text = await file.text();
    const result = parseBackup(text);
    if (!result.ok) {
      dispatch({ type: "FILE_INVALID", error: result.error });
      return;
    }
    // Preview only - nothing is written to localStorage yet.
    dispatch({ type: "FILE_VALID", data: result.data, metadata: result.metadata });
  };

  const handleConfirmRestore = async () => {
    if (state.step !== "previewing") return;
    if (!window.confirm("Restore this backup? This replaces the local Falcon Deck data currently stored in this browser.")) {
      return;
    }
    const { data } = state;
    dispatch({ type: "CONFIRM_RESTORE" });
    const outcome = await restoreBackupToLocal(data);
    if (outcome.ok) {
      dispatch({ type: "RESTORE_SUCCESS" });
    } else {
      dispatch({ type: "RESTORE_FAILURE", error: outcome.error, rolledBack: outcome.rolledBack });
    }
  };

  const handleChooseDifferentFile = () => {
    resetFileInput();
    dispatch({ type: "RESET" });
  };

  return (
    <div className="mb-6 rounded-lg border border-falcon-brown-700/15 bg-white/60 p-4">
      <h2 className="font-semibold text-falcon-brown-900">Restore from a Falcon Deck backup</h2>
      <p className="mt-1 text-sm text-falcon-brown-700/70">
        If this browser&apos;s local Falcon Deck data is ever lost or corrupted, a previously downloaded backup file
        can restore it. This only affects local data on this browser - it never touches the cloud.
      </p>

      {(state.step === "idle" || state.step === "invalid") && (
        <div className="mt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFileChosen(file);
            }}
            className="block text-sm text-falcon-brown-800"
          />
          {state.step === "invalid" && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              {state.error} Choose a different file to try again.
            </p>
          )}
        </div>
      )}

      {state.step === "previewing" && (
        <div className="mt-3 rounded-md border border-falcon-gold-500/40 bg-falcon-gold-300/10 p-3 text-sm">
          <p className="font-semibold text-falcon-brown-900">
            Backup from {new Date(state.metadata.exportedAt).toLocaleString()}
          </p>
          <ul className="mt-2 space-y-0.5 text-falcon-brown-800">
            <li>{state.data.courses.length} course(s)</li>
            <li>{state.data.classSections.length} class section(s)</li>
            <li>{state.data.schedules.length} schedule(s)</li>
            <li>{state.data.lessons.length} lesson(s)</li>
            <li>{state.data.libraryResources.length} library resource(s)</li>
          </ul>
          <p className="mt-2 font-semibold text-red-800">
            Restoring replaces the local Falcon Deck data currently stored in this browser.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleConfirmRestore}
              className="rounded-md border border-red-800/40 px-3 py-1.5 font-semibold text-red-800 hover:bg-red-800/10"
            >
              Restore this backup
            </button>
            <button
              type="button"
              onClick={handleChooseDifferentFile}
              className="rounded-md border border-falcon-brown-700/30 px-3 py-1.5 font-semibold text-falcon-brown-900 hover:bg-falcon-gold-300/20"
            >
              Choose a different file
            </button>
          </div>
        </div>
      )}

      {state.step === "restoring" && <p className="mt-3 text-sm text-falcon-brown-700">Restoring…</p>}

      {state.step === "success" && (
        <div className="mt-3 rounded-md bg-falcon-gold-300/15 p-3 text-sm">
          <p className="font-semibold text-falcon-brown-900">Restored. Reload Falcon Deck to see your restored data.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-md bg-falcon-brown-900 px-3 py-1.5 font-semibold text-falcon-cream-100"
          >
            Reload now
          </button>
        </div>
      )}

      {state.step === "error" && (
        <div className="mt-3 rounded-md bg-red-100 px-3 py-2 text-sm text-red-900">
          <p>{state.error}</p>
          <p className="mt-1">
            {state.rolledBack
              ? "Your previous local data was restored - nothing was lost."
              : "Your previous local data could not be automatically restored - please check Settings before making further changes."}
          </p>
          <button
            type="button"
            onClick={() => {
              resetFileInput();
              dispatch({ type: "RESET" });
            }}
            className="mt-1 font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
