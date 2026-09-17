import type { AppData } from "@/lib/data/types";
import type { BackupMetadata } from "./restoreBackup";

export type RestoreUiState =
  | { step: "idle" }
  | { step: "invalid"; error: string }
  | { step: "previewing"; data: AppData; metadata: BackupMetadata }
  | { step: "restoring"; data: AppData }
  | { step: "success" }
  | { step: "error"; error: string; rolledBack: boolean };

export type RestoreUiAction =
  | { type: "FILE_INVALID"; error: string }
  | { type: "FILE_VALID"; data: AppData; metadata: BackupMetadata }
  | { type: "CONFIRM_RESTORE" }
  | { type: "RESTORE_SUCCESS" }
  | { type: "RESTORE_FAILURE"; error: string; rolledBack: boolean }
  | { type: "RESET" };

export const INITIAL_RESTORE_UI_STATE: RestoreUiState = { step: "idle" };

/** `CONFIRM_RESTORE` only has an effect from "previewing" - restore is never one click away from any other state. */
export function restoreUiReducer(state: RestoreUiState, action: RestoreUiAction): RestoreUiState {
  switch (action.type) {
    case "FILE_INVALID":
      return { step: "invalid", error: action.error };
    case "FILE_VALID":
      return { step: "previewing", data: action.data, metadata: action.metadata };
    case "CONFIRM_RESTORE":
      return state.step === "previewing" ? { step: "restoring", data: state.data } : state;
    case "RESTORE_SUCCESS":
      return { step: "success" };
    case "RESTORE_FAILURE":
      return { step: "error", error: action.error, rolledBack: action.rolledBack };
    case "RESET":
      return { step: "idle" };
  }
}
