import type { AppData } from "@/lib/data/types";

/** Bumped only if the backup file's own shape changes - independent of the app schema version. */
export const BACKUP_FORMAT_VERSION = 1;

export interface LocalDataBackup {
  backupFormatVersion: number;
  exportedAt: string;
  appData: AppData;
}

/**
 * Builds the backup payload - pure, no browser APIs, so it's directly
 * testable. Must be called (and the result durably saved, e.g. via
 * `triggerBrowserDownload`) *before* migrateLocalData runs, per the
 * migration milestone's requirement that a local backup exist independent
 * of both the browser's storage and Supabase.
 */
export function buildLocalDataBackup(appData: AppData): LocalDataBackup {
  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    // Deep-cloned so later in-memory mutation of the live AppData can never
    // retroactively change an already-built backup snapshot.
    appData: structuredClone(appData),
  };
}

export function serializeBackup(backup: LocalDataBackup): string {
  return JSON.stringify(backup, null, 2);
}

/**
 * Browser-only: triggers a real file download of the backup. Not used by
 * any test in this phase (no browser context) - kept separate from
 * `buildLocalDataBackup`/`serializeBackup` so those two stay unit-testable
 * in Node.
 */
export function triggerBrowserDownload(backup: LocalDataBackup, filenamePrefix = "falcon-deck-backup"): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("triggerBrowserDownload can only run in a browser.");
  }
  const json = serializeBackup(backup);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenamePrefix}-${backup.exportedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
