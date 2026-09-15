"use client";

import { useState, type RefObject } from "react";
import { useFullscreen } from "@/lib/hooks/useFullscreen";

/**
 * Obvious, discoverable Fullscreen toggle for Present/Preview Mode - top
 * right, immediately left of the ToolTray toggle (top-4 right-4), rather
 * than any bottom corner. At the BenQ presentation tier the card grid
 * fills the viewport edge-to-edge with no reserved margin at the bottom -
 * a bottom-anchored fixed control there would sit on top of whichever
 * card happens to be in that corner (see scripts/verify-present-layout.ts,
 * which measures exactly this). The header row above the grid is never
 * part of the card layout, so a control anchored there can never collide
 * with card content regardless of how tall the cards get. Only ever calls
 * into the Fullscreen API from this button's own click handler (see
 * `useFullscreen`) - never automatically.
 */
export function FullscreenButton({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const { isFullscreen, isUnsupported, fallbackMessage, toggle } = useFullscreen(targetRef);
  const [dismissed, setDismissed] = useState(false);

  return (
    <div className="fixed right-20 top-4 z-20 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          setDismissed(false);
          void toggle();
        }}
        aria-pressed={isFullscreen}
        className="rounded-md border border-falcon-cream-200/20 bg-falcon-brown-950/80 px-3 py-1.5 text-xs font-semibold text-falcon-cream-200/70 shadow-lg transition-colors hover:bg-falcon-brown-900 hover:text-falcon-cream-100"
      >
        {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
      </button>
      {isUnsupported && fallbackMessage && !dismissed && (
        <div className="animate-present-fade max-w-xs rounded-lg border border-falcon-cream-200/10 bg-falcon-brown-950/95 p-3 text-xs text-falcon-cream-200/80 shadow-xl">
          <p>{fallbackMessage}</p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="mt-2 font-semibold text-falcon-gold-400 hover:text-falcon-gold-300"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
