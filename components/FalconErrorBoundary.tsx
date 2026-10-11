"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { buildErrorReport } from "@/lib/diagnostics/errorReport";

const MAX_AUTO_RETRIES = 3;
const AUTO_RETRY_DELAY_MS = 1500;

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retryKey: number;
  report: string | null;
  copyStatus: "idle" | "copied" | "failed";
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
 *
 * Also keeps a plain-text diagnostic report (see lib/diagnostics/errorReport.ts)
 * once it gives up, with a Copy button - `console.error` alone is useless to
 * a teacher on a school-managed Chrome profile with DevTools locked down.
 * The report is built ONLY from the caught error/component stack/location/
 * browser string; this boundary never reads AppData, so there is no path for
 * lesson content, credentials, or tokens to end up in it.
 */
export class FalconErrorBoundary extends Component<Props, State> {
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;

  state: State = { hasError: false, retryKey: 0, report: null, copyStatus: "idle" };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    console.error("Falcon Deck render error:", error);

    const attemptNumber = this.retryCount + 1;
    const report =
      typeof window !== "undefined"
        ? buildErrorReport({
            error,
            componentStack: errorInfo.componentStack ?? null,
            href: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            attemptNumber,
            maxAttempts: MAX_AUTO_RETRIES + 1,
            buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "local",
          })
        : null;
    this.setState({ report, copyStatus: "idle" });

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

  // `retryCount` is a plain instance field, not state, so nothing else
  // resets it. Without this, a SECOND, unrelated crash later in the same
  // mounted lifetime (plausible over a multi-hour classroom day) would
  // inherit whatever count a prior, already-recovered incident left behind
  // - up to skipping its own silent auto-retries entirely. A render that
  // runs with `hasError` having just gone from true to false is exactly a
  // successful retry (an unsuccessful one would have re-thrown into
  // `componentDidCatch` instead of reaching `componentDidUpdate`), so that
  // transition is the correct, and only, signal to treat the incident as
  // resolved and let the next one start its own attempt count at 1.
  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (prevState.hasError && !this.state.hasError) {
      this.retryCount = 0;
    }
  }

  private copyReport = async () => {
    if (!this.state.report) return;
    try {
      await navigator.clipboard.writeText(this.state.report);
      this.setState({ copyStatus: "copied" });
    } catch {
      this.setState({ copyStatus: "failed" });
    }
  };

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
            <>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 rounded-md bg-falcon-gold-300 px-4 py-2 font-semibold text-falcon-brown-950 hover:bg-falcon-gold-200"
              >
                Reload Falcon Deck
              </button>

              {this.state.report && (
                <details className="mt-4 w-full max-w-xl text-left">
                  <summary className="cursor-pointer text-sm font-medium text-falcon-cream-200/70 hover:text-falcon-cream-200">
                    Technical details (for IT/support)
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <textarea
                      readOnly
                      value={this.state.report}
                      onFocus={(event) => event.currentTarget.select()}
                      rows={10}
                      className="w-full rounded-md border border-falcon-cream-200/20 bg-falcon-brown-900 p-2 font-mono text-xs text-falcon-cream-100"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={this.copyReport}
                        className="rounded-md border border-falcon-cream-200/30 px-3 py-1.5 text-sm font-semibold text-falcon-cream-100 hover:bg-falcon-cream-200/10"
                      >
                        Copy error report
                      </button>
                      {this.state.copyStatus === "copied" && (
                        <span className="text-sm text-falcon-cream-200/70">Copied.</span>
                      )}
                      {this.state.copyStatus === "failed" && (
                        <span className="text-sm text-falcon-cream-200/70">
                          Couldn&apos;t copy automatically - select the text above and copy it manually.
                        </span>
                      )}
                    </div>
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
