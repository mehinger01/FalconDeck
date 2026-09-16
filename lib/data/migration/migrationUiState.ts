/**
 * PHASE A: the migration action is UI/state plumbing only - flipping this
 * single flag is the entire Phase B change needed to let the "Migrate to
 * cloud" button in /setup actually call migrateLocalData/
 * validateMigratedData/markMigrationComplete. Nothing else in
 * MigrationSetupCard needs to change for that.
 */
export const MIGRATION_ACTION_ENABLED = false;

export type MigrationUiState =
  | { step: "not-started" }
  | { step: "backup-downloaded" }
  | { step: "migrating" }
  | { step: "success" }
  | { step: "error"; message: string };

export type MigrationUiAction =
  | { type: "BACKUP_DOWNLOADED" }
  | { type: "MIGRATE_START" }
  | { type: "MIGRATE_SUCCESS" }
  | { type: "MIGRATE_FAILURE"; message: string }
  | { type: "RESET" };

export const INITIAL_MIGRATION_UI_STATE: MigrationUiState = { step: "not-started" };

export function migrationUiReducer(state: MigrationUiState, action: MigrationUiAction): MigrationUiState {
  switch (action.type) {
    case "BACKUP_DOWNLOADED":
      return { step: "backup-downloaded" };
    case "MIGRATE_START":
      return { step: "migrating" };
    case "MIGRATE_SUCCESS":
      return { step: "success" };
    case "MIGRATE_FAILURE":
      return { step: "error", message: action.message };
    case "RESET":
      return { step: "not-started" };
  }
}
