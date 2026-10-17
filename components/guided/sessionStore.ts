"use client";

import { useSyncExternalStore } from "react";
import type { SetupDraftSession, SetupSessionSnapshot } from "@/lib/onboarding/setupDraftSession";
import type { SetupRepository } from "@/lib/onboarding/setupRepository";
import { createBrowserSetupRepository } from "@/lib/data/supabaseSetupRepository";

export interface SessionStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SetupSessionSnapshot;
}

/**
 * SetupDraftSession.getSnapshot() builds a new object on every call;
 * useSyncExternalStore needs the same object back until something changed.
 * This caches one snapshot per notification.
 */
export function createSessionStore(session: SetupDraftSession): SessionStore {
  let cached = session.getSnapshot();
  const listeners = new Set<() => void>();
  session.subscribe(() => {
    cached = session.getSnapshot();
    for (const listener of listeners) listener();
  });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => cached,
  };
}

export function useSessionSnapshot(store: SessionStore): SetupSessionSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * The browser SetupRepository, created on first use rather than during
 * render - the session object is constructed in a useState initializer,
 * which also runs during server rendering, where no browser client exists.
 */
export function lazyBrowserSetupRepository(organizationId: string): SetupRepository {
  let repository: SetupRepository | null = null;
  const get = () => (repository ??= createBrowserSetupRepository(organizationId));
  return {
    getState: () => get().getState(),
    saveDraft: (expectedRevision, payload, expectedPreferences) => get().saveDraft(expectedRevision, payload, expectedPreferences),
    completeSetup: (operationId, expectedRevision) => get().completeSetup(operationId, expectedRevision),
  };
}
