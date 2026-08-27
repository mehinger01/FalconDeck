import { createDemoModeAppData } from "./demoModeData";
import type { AppData, DataRepository, SaveResult } from "./types";

/**
 * Demo Mode's DataRepository - in-memory only, NEVER writes to
 * localStorage or the real DataRepository singleton.
 *
 * By default it still supports the canned demo seed, but callers may pass
 * an AppData snapshot (normally the teacher's current saved setup). That
 * snapshot is cloned into memory so Demo Mode can exercise the teacher's
 * real schedules/classes/calendar without risking production data.
 */
export class DemoDataRepository implements DataRepository {
  private state: AppData;

  constructor(initialState?: AppData) {
    this.state = initialState ? structuredClone(initialState) : createDemoModeAppData();
  }

  /** The exact object this repository will also return from the first `load()` call. */
  getInitialSnapshot(): AppData {
    return this.state;
  }

  async load(): Promise<AppData> {
    return this.state;
  }

  async save(data: AppData): Promise<SaveResult> {
    this.state = data;
    return { ok: true };
  }

  subscribeToExternalChanges(): () => void {
    return () => {};
  }
}
