import { createDemoModeAppData } from "./demoModeData";
import type { AppData, DataRepository, SaveResult } from "./types";

/**
 * Demo Mode's DataRepository - in-memory only, NEVER touches
 * localStorage or the real DataRepository singleton (lib/data/localStorageRepository.ts).
 * State lives on the instance itself; DemoAppDataProvider creates exactly
 * one instance per demo session (via useState's lazy initializer, so it
 * survives re-renders and client-side navigation within /demo), and a
 * full page reload naturally discards it and starts fresh - the
 * deliberate "refresh resets demo state" behavior. No cross-tab sync
 * either: a demo session in one tab has no business affecting another.
 */
export class DemoDataRepository implements DataRepository {
  private state: AppData;

  constructor() {
    this.state = createDemoModeAppData();
  }

  /** The exact object this repository will also return from the first `load()` call - lets the provider seed its reducer with the identical value instead of computing the seed twice. */
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
