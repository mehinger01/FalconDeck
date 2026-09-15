/**
 * Standalone verification for `createClockStore` (lib/hooks/clockStore.ts)
 * - the `useSyncExternalStore` subscribe/getSnapshot pair behind `useNow`.
 *
 * This is a regression test for a real "Maximum update depth exceeded" /
 * "The result of getSnapshot should be cached to avoid an infinite loop"
 * crash: the old `useNow.ts` called `Date.now()` fresh inside `getSnapshot`
 * itself, so React saw a "changed" store on every single render and
 * re-rendered forever.
 *
 * `createClockStore` takes every side effect (the clock, timers, DOM
 * listeners) as injected `ClockStoreDeps`, so it's exercised here with a
 * fully controllable fake clock/timer/listener harness - no jsdom, no
 * react-test-renderer, no real timers to wait on, matching this project's
 * existing scripts/verify-*.ts convention:
 *
 *   npx tsx scripts/verify-clockstore.ts
 */

import { createClockStore, type ClockStoreDeps } from "@/lib/hooks/clockStore";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

/**
 * A fully fake, synchronous "clock + timer + DOM listener" environment.
 * Nothing here touches a real clock, a real setInterval, or a real DOM -
 * every tick/resync is fired manually by the test, so behavior is
 * deterministic and instant.
 */
function createFakeClockEnvironment() {
  let currentTime = 1_000_000;
  let intervalHandler: (() => void) | null = null;
  let intervalDelayMs: number | null = null;
  let nextIntervalId = 0;
  let activeIntervalId: number | null = null;
  let visible = true;
  const visibilityListeners = new Set<() => void>();
  const focusListeners = new Set<() => void>();
  const pageShowListeners = new Set<() => void>();

  const deps: ClockStoreDeps = {
    now: () => currentTime,
    setInterval: (handler, delayMs) => {
      nextIntervalId += 1;
      activeIntervalId = nextIntervalId;
      intervalHandler = handler;
      intervalDelayMs = delayMs;
      return activeIntervalId;
    },
    clearInterval: (id) => {
      if (id === activeIntervalId) {
        activeIntervalId = null;
        intervalHandler = null;
      }
    },
    addVisibilityChangeListener: (handler) => {
      visibilityListeners.add(handler);
    },
    removeVisibilityChangeListener: (handler) => {
      visibilityListeners.delete(handler);
    },
    addFocusListener: (handler) => {
      focusListeners.add(handler);
    },
    removeFocusListener: (handler) => {
      focusListeners.delete(handler);
    },
    addPageShowListener: (handler) => {
      pageShowListeners.add(handler);
    },
    removePageShowListener: (handler) => {
      pageShowListeners.delete(handler);
    },
    isVisible: () => visible,
  };

  return {
    deps,
    advanceTime: (ms: number) => {
      currentTime += ms;
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
    fireIntervalTick: () => intervalHandler?.(),
    fireVisibilityChange: () => visibilityListeners.forEach((listener) => listener()),
    fireFocus: () => focusListeners.forEach((listener) => listener()),
    firePageShow: () => pageShowListeners.forEach((listener) => listener()),
    hasActiveInterval: () => intervalHandler !== null,
    lastIntervalDelayMs: () => intervalDelayMs,
    visibilityListenerCount: () => visibilityListeners.size,
    focusListenerCount: () => focusListeners.size,
    pageShowListenerCount: () => pageShowListeners.size,
  };
}

console.log("1. Consecutive snapshot reads are Object.is equal without notification");
{
  const env = createFakeClockEnvironment();
  const store = createClockStore(1000, env.deps);

  const first = store.getSnapshot();
  env.advanceTime(60_000); // real time moving forward must NOT change the snapshot on its own
  const second = store.getSnapshot();
  const third = store.getSnapshot();

  check("getSnapshot is unaffected by the clock advancing without a tick/resync", Object.is(first, second));
  check("repeated reads with no notification in between are Object.is equal to each other", Object.is(second, third));
}

console.log("\n2. A timer/focus/visibility update changes the cached snapshot BEFORE notifying subscribers");
{
  const env = createFakeClockEnvironment();
  const store = createClockStore(1000, env.deps);
  const initial = store.getSnapshot();

  let notifyCount = 0;
  let snapshotSeenDuringNotify: number | null = null;
  const unsubscribe = store.subscribe(() => {
    notifyCount += 1;
    snapshotSeenDuringNotify = store.getSnapshot();
  });

  env.advanceTime(5000);
  env.fireIntervalTick();
  check("interval tick notified exactly once", notifyCount === 1);
  check(
    "the subscriber callback already sees the NEW cached value (cache is updated before notify, not after)",
    snapshotSeenDuringNotify === initial + 5000,
  );
  check("getSnapshot after the tick agrees with what the subscriber saw during notify", store.getSnapshot() === snapshotSeenDuringNotify);

  env.advanceTime(2000);
  env.setVisible(true);
  env.fireFocus();
  check("focus resync also updates the cache before notifying", snapshotSeenDuringNotify === initial + 7000);
  check("focus resync notified again", notifyCount === 2);

  env.advanceTime(1000);
  env.fireVisibilityChange(); // still visible
  check("visibilitychange resync (while visible) updates the cache before notifying", snapshotSeenDuringNotify === initial + 8000);
  check("visibilitychange resync notified again", notifyCount === 3);

  const notifyCountBeforeHidden = notifyCount;
  const snapshotBeforeHidden = store.getSnapshot();
  env.advanceTime(1000);
  env.setVisible(false);
  env.fireVisibilityChange(); // hidden - must NOT resync
  check("resync does not fire while hidden (no spurious notify)", notifyCount === notifyCountBeforeHidden);
  check("cache is untouched while hidden", store.getSnapshot() === snapshotBeforeHidden);

  // pageshow (bfcache restoration) resyncs unconditionally - unlike
  // visibilitychange/focus, it isn't gated on isVisible(), since the page
  // is definitionally back on screen when this fires. Two seconds have
  // elapsed since snapshotBeforeHidden was captured: one from the
  // hidden-visibilitychange attempt above (which left the cache
  // untouched), plus this one.
  env.advanceTime(1000);
  env.firePageShow();
  check("pageshow updates the cache before notifying, even while `visible` was left false", snapshotSeenDuringNotify === snapshotBeforeHidden + 2000);
  check("pageshow notified", notifyCount === notifyCountBeforeHidden + 1);

  unsubscribe();
}

console.log("\n3. Subscribing and unsubscribing do not leak intervals or event listeners");
{
  const env = createFakeClockEnvironment();
  const store = createClockStore(1000, env.deps);

  check("before subscribing: no interval registered", !env.hasActiveInterval());
  check(
    "before subscribing: no listeners registered",
    env.visibilityListenerCount() === 0 && env.focusListenerCount() === 0 && env.pageShowListenerCount() === 0,
  );

  const unsubscribe = store.subscribe(() => {});
  check("after subscribing: the interval uses the requested delay", env.lastIntervalDelayMs() === 1000);
  check("after subscribing: interval is active", env.hasActiveInterval());
  check(
    "after subscribing: exactly one visibility, focus, and pageshow listener registered",
    env.visibilityListenerCount() === 1 && env.focusListenerCount() === 1 && env.pageShowListenerCount() === 1,
  );

  unsubscribe();
  check("after unsubscribing: the interval is cleared (no leak)", !env.hasActiveInterval());
  check(
    "after unsubscribing: all three listeners are removed (no leak)",
    env.visibilityListenerCount() === 0 && env.focusListenerCount() === 0 && env.pageShowListenerCount() === 0,
  );

  // A remount (unsubscribe -> subscribe again) must not accumulate stale
  // registrations from the previous subscription.
  const unsubscribeAgain = store.subscribe(() => {});
  check(
    "re-subscribing after a clean unsubscribe registers exactly one fresh interval/listener set, not accumulated ones",
    env.hasActiveInterval() &&
      env.visibilityListenerCount() === 1 &&
      env.focusListenerCount() === 1 &&
      env.pageShowListenerCount() === 1,
  );
  unsubscribeAgain();
  check(
    "final state after the second unsubscribe is fully cleaned up again",
    !env.hasActiveInterval() &&
      env.visibilityListenerCount() === 0 &&
      env.focusListenerCount() === 0 &&
      env.pageShowListenerCount() === 0,
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
