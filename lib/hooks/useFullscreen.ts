"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  deriveChangeState,
  deriveErrorState,
  deriveInitialState,
  INACTIVE_STATE,
  type FullscreenState,
} from "@/lib/present/fullscreenState";

/**
 * Wires `fullscreenState.ts` to a real target element and `document`'s
 * native fullscreen events. `requestFullscreen()`/`exitFullscreen()` are
 * only ever called from `toggle()`, which only ever runs inside a click
 * handler - never from an effect on mount - so fullscreen can never start
 * automatically. Escape is handled entirely by the browser itself; this
 * hook only listens for the `fullscreenchange` it fires to stay in sync.
 *
 * Standard, unprefixed Fullscreen API only - no Safari `webkit`-prefixed
 * fallback shims (a classroom BenQ board is effectively always
 * Chromium-based); an unsupported/blocked browser gets the fallback
 * message from `fullscreenState.ts` instead.
 */
export function useFullscreen(targetRef: RefObject<HTMLElement | null>) {
  // Computed during render (a lazy initializer), not via setState inside an
  // effect - document.fullscreenEnabled is a one-time environment check,
  // not something to subscribe to, so there's nothing to "synchronize" an
  // effect for here (see https://react.dev/learn/you-might-not-need-an-effect).
  // On the server this evaluates to INACTIVE_STATE (document is undefined);
  // supported browsers - the overwhelming common case - resolve to that
  // same INACTIVE_STATE on the client too, so hydration matches. Only a
  // genuinely unsupported/restricted browser could show the fallback
  // message a render later than a real effect would have - an acceptable,
  // one-time tradeoff for a rare case.
  const [state, setState] = useState<FullscreenState>(() =>
    typeof document === "undefined" ? INACTIVE_STATE : deriveInitialState(document.fullscreenEnabled === true),
  );
  // Guards against setting state from a stale/unmounted hook instance.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    function handleFullscreenChange() {
      if (!mountedRef.current) return;
      setState(deriveChangeState(document.fullscreenElement === targetRef.current));
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(async () => {
    const target = targetRef.current;
    if (!target) return;

    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
      } else {
        await target.requestFullscreen();
      }
    } catch {
      if (mountedRef.current) setState(deriveErrorState());
    }
  }, [targetRef]);

  return {
    isFullscreen: state.status === "active",
    isUnsupported: state.status === "unsupported",
    fallbackMessage: state.fallbackMessage,
    toggle,
  };
}
