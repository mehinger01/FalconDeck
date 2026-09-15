/**
 * The `useSyncExternalStore` subscribe/getSnapshot pair behind `useNow`,
 * plus the tick/resync logic that keeps them correct - pure, no React, no
 * DOM globals referenced directly (every side effect is injected via
 * `ClockStoreDeps`), so it's directly testable without a DOM/React
 * renderer. See scripts/verify-clockstore.ts.
 *
 * Resyncs on visibilitychange, focus, and pageshow (bfcache restoration) -
 * browsers throttle a backgrounded tab's interval heavily (Chrome: as
 * infrequent as once/minute after ~5 minutes hidden), so without these a
 * teacher returning to Falcon Deck could stare at a stale period/countdown
 * for up to a minute.
 *
 * `getSnapshot` MUST return a value that stays identical between explicit
 * `notify()` calls: `useSyncExternalStore` calls it on every render (not
 * just after a notification) to detect concurrent "tearing" against
 * whatever `subscribe` last reported, and a value that differs on every
 * call (e.g. reading `Date.now()` fresh inside `getSnapshot` itself - the
 * bug this module fixes) makes every single render look like the store
 * changed, forcing React into an immediate, unbounded re-render loop
 * ("Maximum update depth exceeded" / "The result of getSnapshot should be
 * cached to avoid an infinite loop"). `cachedNow` is that cache - written
 * only inside `tick`, immediately before notifying subscribers.
 */

export interface ClockStoreDeps {
  now: () => number;
  setInterval: (handler: () => void, intervalMs: number) => unknown;
  clearInterval: (id: unknown) => void;
  addVisibilityChangeListener: (handler: () => void) => void;
  removeVisibilityChangeListener: (handler: () => void) => void;
  addFocusListener: (handler: () => void) => void;
  removeFocusListener: (handler: () => void) => void;
  /** Fires on `pageshow`, including bfcache restoration (navigating back/forward to an already-rendered page) - a case `visibilitychange`/`focus` don't reliably cover. */
  addPageShowListener: (handler: () => void) => void;
  removePageShowListener: (handler: () => void) => void;
  isVisible: () => boolean;
}

export interface ClockStore {
  getSnapshot: () => number;
  subscribe: (onStoreChange: () => void) => () => void;
}

export function createClockStore(intervalMs: number, deps: ClockStoreDeps): ClockStore {
  let cachedNow = deps.now();

  function getSnapshot(): number {
    return cachedNow;
  }

  function subscribe(onStoreChange: () => void): () => void {
    // The one place `cachedNow` is ever written - always immediately
    // followed by the notification that tells React to re-read it.
    const tick = () => {
      cachedNow = deps.now();
      onStoreChange();
    };

    const id = deps.setInterval(tick, intervalMs);

    // Guarded so a resync never fires while the tab is still hidden.
    const resync = () => {
      if (deps.isVisible()) tick();
    };
    deps.addVisibilityChangeListener(resync);
    deps.addFocusListener(resync);

    // bfcache restoration (browser back/forward to an already-rendered
    // page) doesn't reliably fire visibilitychange/focus in every browser,
    // so it gets its own unconditional resync - the page is, by
    // definition, back on screen when `pageshow` fires.
    deps.addPageShowListener(tick);

    return () => {
      deps.clearInterval(id);
      deps.removeVisibilityChangeListener(resync);
      deps.removeFocusListener(resync);
      deps.removePageShowListener(tick);
    };
  }

  return { getSnapshot, subscribe };
}
