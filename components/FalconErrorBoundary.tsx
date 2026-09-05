"use client";

import { Component, type ReactNode } from "react";

const MAX_AUTO_RETRIES = 3;
const AUTO_RETRY_DELAY_MS = 1500;

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retryKey: number;
}

/**
 * Falcon Deck has no server-fetched state to go stale, but it has no error
 * boundary anywhere either - so any unexpected render-time throw (a bad
 * lookup on a newly-resolved schedule state, a JS chunk that failed to load
 * after the tab sat idle across a deploy, a transient hydration mismatch on
 * resume) unmounts the whole tree with nothing to catch it, leaving a
 * classroom teacher on a blank page until they manually reload.
 *
 * Recovers automatically first: most causes here are transient (the retry
 * itself, remounting via `retryKey`, re-resolves current state fresh from
 * the clock and localStorage). Only after `MAX_AUTO_RETRIES` silent attempts
 * does it stop and ask for a manual reload, so a persistent bug doesn't loop
 * forever.
 */
export class FalconErrorBoundary extends Component<Props, State> {
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;

  state: State = { hasError: false, retryKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Falcon Deck render error:", error);
    if (this.retryCount < MAX_AUTO_RETRIES) {
      this.retryCount += 1;
      this.retryTimeout = setTimeout(() => {
        this.setState((prev) => ({ hasError: false, retryKey: prev.retryKey + 1 }));
      }, AUTO_RETRY_DELAY_MS);
    }
  }

  componentWillUnmount() {
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
  }

  render() {
    if (this.state.hasError) {
      const willAutoRetry = this.retryCount < MAX_AUTO_RETRIES;
      return (
        <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-4 bg-falcon-brown-950 px-6 text-center text-falcon-cream-100">
          <p className="text-sm font-semibold uppercase tracking-widest text-falcon-gold-300">Falcon Deck</p>
          <h1 className="text-2xl font-bold">Falcon Deck encountered a display problem.</h1>
          <p className="text-falcon-cream-200/70">
            {willAutoRetry ? "Reconnecting Falcon Deck…" : "Automatic recovery didn't resolve it."}
          </p>
          {!willAutoRetry && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-md bg-falcon-gold-300 px-4 py-2 font-semibold text-falcon-brown-950 hover:bg-falcon-gold-200"
            >
              Reload Falcon Deck
            </button>
          )}
        </div>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
