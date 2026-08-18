import { createDemoAppData } from "./demoData";
import type { AppData, DataRepository } from "./types";

/**
 * In-memory demo repository. `save` is intentionally a no-op: Phase 1 has
 * no backend, so persistence between sessions is handled client-side (see
 * `lib/store`), not by this repository. Swapping in a real backend later
 * means writing a repository that implements the same `DataRepository`
 * interface and persists both `load` and `save` remotely - nothing else in
 * the app needs to change.
 */
export class DemoDataRepository implements DataRepository {
  async load(): Promise<AppData> {
    return createDemoAppData();
  }

  async save(): Promise<void> {
    // No-op: demo data is not persisted server-side.
  }
}

export const dataRepository: DataRepository = new DemoDataRepository();
