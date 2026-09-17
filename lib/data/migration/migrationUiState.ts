/**
 * PHASE B: the "Migrate to cloud" button in /setup now calls
 * migrateLocalData/validateMigratedData/markMigrationComplete for real -
 * see MigrationSetupCard's handleMigrate. This flag stays as the single,
 * explicit kill switch: flipping it back to `false` disables the action
 * again without touching the rest of the component.
 */
export const MIGRATION_ACTION_ENABLED = true;

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
