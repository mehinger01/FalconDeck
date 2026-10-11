/**
 * Builds the plain-text diagnostic report `FalconErrorBoundary` shows (and
 * lets a teacher copy) once automatic recovery gives up. Kept as a pure
 * function - no React, no DOM access beyond the values the boundary already
 * has to hand - so it's directly testable (see scripts/verify-error-report.ts)
 * and so the boundary itself stays a thin renderer around it.
 *
 * Deliberately NEVER touches AppData/lesson content: the boundary has no
 * context access to it in the first place, and this function only ever
 * receives the error/componentStack/location/browser values below - there is
 * no lesson text, resource URL, or teacher-entered content anywhere in this
 * report by construction.
 *
 * Two independent layers of sanitization, because the two leak paths are
 * shaped differently:
 *  - The page URL is redacted by an ALLOWLIST (`ALLOWED_QUERY_PARAM_KEYS`):
 *    only this app's own known, non-secret route params pass through as-is;
 *    every other query key's value is redacted regardless of what the key is
 *    named. Deny-by-default, so a future route adding e.g. an `apiKey` param
 *    doesn't depend on anyone remembering to blocklist it here.
 *  - Error messages and both stacks are free text, not key/value pairs, so an
 *    allowlist doesn't apply - `sanitizeSensitiveText` instead pattern-matches
 *    and redacts the SHAPES a leaked credential actually takes (a JWT, a
 *    `Bearer ...` header, a `token=...`/`code=...`/`session: ...`-style
 *    assignment) wherever they appear in that text.
 *
 * `buildErrorReport` itself must never throw: it runs inside
 * `componentDidCatch`, on an error boundary that has nowhere further to
 * escalate to - an exception here would blank the recovery screen itself
 * with nothing left to catch it. Every step that touches the untrusted
 * `error` value (whose `.message`/`.stack`/`.name` can be attacker- or
 * library-defined getters, and whose `toString()` can itself throw on a
 * non-Error throw) is wrapped individually so one bad field degrades to a
 * placeholder instead of losing the whole report; if report assembly still
 * fails outright, a fallback report is built from only the handful of
 * already-plain-string inputs (itself routing the URL through the same
 * allowlist helper, never the raw href); if even THAT throws, a fixed
 * constant string is returned - there is no fourth level to fall back to,
 * so that level cannot itself contain anything that could fail.
 */

export interface ErrorReportInput {
  error: unknown;
  /** `errorInfo.componentStack` from `componentDidCatch`, or `null` if unavailable. */
  componentStack: string | null;
  /** `window.location.href` at the moment of the catch. */
  href: string;
  userAgent: string;
  /** ISO timestamp of the catch. */
  timestamp: string;
  /** How many auto-retries had already run when this error was caught (1 = the first failure). */
  attemptNumber: number;
  maxAttempts: number;
  /** `NEXT_PUBLIC_BUILD_ID` (short commit SHA, or "local" outside Vercel) - lets a report be matched to the exact deploy it came from. See next.config.ts. */
  buildId: string;
}

/**
 * Every query param this app's own routes ever use (Present Mode's
 * mode/date/section/block, Week's date/course, Lessons' date/section) - see
 * PresentModeControls.buildPresentUrl, lib/week/weekLinks.ts. Deliberately a
 * short, explicit list rather than "whatever doesn't look sensitive": this
 * boundary wraps the whole app (including, in principle, an auth callback
 * route carrying a `code`), so anything NOT on this list is redacted, not
 * just names that happen to match a blocklist pattern.
 */
const ALLOWED_QUERY_PARAM_KEYS = new Set(["mode", "date", "section", "block", "course"]);

const MAX_SECTION_CHARS = 4000;

/** The fixed base64url header every JWT starts with (Supabase anon/service/session tokens included). Matches all three dot-separated segments so nothing past the header survives either. */
const JWT_PATTERN = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
/** An `Authorization: Bearer <token>` header value, however it's embedded in free text. */
const BEARER_PATTERN = /\bBearer\s+[\w.-]+/gi;
/**
 * A `key=value`/`key: value`/`key="value"` assignment whose key name is
 * credential-shaped - covers a plain (non-JWT) token/code/session/secret
 * embedded in a thrown error's message, e.g. a Supabase client error that
 * echoes back the request it failed to make. `code` and `session` are
 * deliberately included even though both words have innocuous everyday
 * uses ("status code", "session started") - the cost of over-redacting a
 * harmless diagnostic phrase is far lower than the cost of an OAuth `code`
 * or session token surviving into a report a teacher pastes into an email.
 *
 * Deliberately does NOT include "authorization" - BEARER_PATTERN already
 * owns that shape (`Authorization: Bearer <token>`, by far the common
 * case), and running both over the same text would have this pattern
 * re-match the literal word "Bearer" as authorization's "value" right
 * after BEARER_PATTERN already redacted the token following it.
 */
const KEY_VALUE_PATTERN =
  /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|session[_-]?token|session|secret|password|credential|token|code)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

/** Redacts the SHAPES a leaked credential takes in free text (error messages, stacks) - see module doc comment for why this is pattern-based rather than allowlisted like the URL. */
function sanitizeSensitiveText(text: string): string {
  return text
    // Bearer first: `[\w.-]+` already matches an entire JWT (letters,
    // digits, `_`, `.`, `-`) in one greedy run, so "Bearer <jwt>" collapses
    // to "Bearer [redacted]" wholesale. JWT_PATTERN runs after only to
    // catch a bare JWT that wasn't preceded by "Bearer " at all.
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(JWT_PATTERN, "[redacted-jwt]")
    .replace(KEY_VALUE_PATTERN, (_match, key: string) => `${key}=[redacted]`);
}

/** Strips the origin and redacts every query value whose key isn't on the explicit allowlist - everything else (the path, and this app's own ordinary params) passes through unchanged. Never throws. */
export function redactSensitiveQueryParams(href: string): string {
  try {
    const url = new URL(href);
    for (const key of Array.from(url.searchParams.keys())) {
      if (!ALLOWED_QUERY_PARAM_KEYS.has(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return "[unavailable]";
  }
}

/** `String(value)` without trusting `value.toString()` not to throw (a non-Error thrown value is fully caller-defined). */
function safeStringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "(unstringifiable value)";
  }
}

/** `error instanceof Error ? error.name : ...` without trusting `.name` to be a plain, non-throwing property - a hostile/custom Error subclass can make it a throwing getter. */
function safeErrorName(error: unknown): string {
  try {
    return error instanceof Error && typeof error.name === "string" && error.name ? error.name : "UnknownError";
  } catch {
    return "UnknownError";
  }
}

/** Best-effort `error.message`/`error.stack` access - both can be library- or attacker-defined getters, so neither is trusted not to throw. */
function safeErrorField(error: unknown, field: "message" | "stack"): string | null {
  try {
    if (!(error instanceof Error)) return null;
    const value = error[field];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function buildReportSections(input: ErrorReportInput): string {
  const { error, componentStack, href, userAgent, timestamp, attemptNumber, maxAttempts, buildId } = input;

  // Sanitized even though `.name` is conventionally a short class name like
  // "TypeError" - a hostile/custom Error subclass can set it to arbitrary
  // text, and the two sanitization layers documented above exist precisely
  // so no single untrusted field is exempt from them.
  const name = sanitizeSensitiveText(safeErrorName(error));
  const rawMessage = safeErrorField(error, "message") ?? safeStringify(error);
  const message = sanitizeSensitiveText(rawMessage);

  const rawStack = safeErrorField(error, "stack");
  const stack = rawStack ? truncate(sanitizeSensitiveText(rawStack), MAX_SECTION_CHARS) : "(no stack available)";

  const componentStackSection = componentStack
    ? truncate(sanitizeSensitiveText(componentStack.trim()), MAX_SECTION_CHARS)
    : "(no component stack available)";

  return [
    "Falcon Deck error report",
    `Build: ${buildId}`,
    `Time: ${timestamp}`,
    `Page: ${redactSensitiveQueryParams(href)}`,
    `Browser: ${userAgent}`,
    `Auto-recovery: attempt ${attemptNumber} of ${maxAttempts}`,
    "",
    `${name}: ${message}`,
    "",
    "Stack:",
    stack,
    "",
    "Component stack:",
    componentStackSection,
  ].join("\n");
}

/**
 * Only reached if `buildReportSections` itself threw - so every field here
 * is read in the most defensive way available, never re-touching whatever
 * made the primary path fail. The page URL is routed through
 * `redactSensitiveQueryParams` (never the raw `href`) so this fallback can
 * never be the one path that skips redaction.
 */
function buildFallbackReport(input: Partial<ErrorReportInput> | undefined, cause: unknown): string {
  const buildId = typeof input?.buildId === "string" && input.buildId ? input.buildId : "(unavailable)";
  const timestamp = typeof input?.timestamp === "string" && input.timestamp ? input.timestamp : "(unavailable)";
  const page = typeof input?.href === "string" ? redactSensitiveQueryParams(input.href) : "(unavailable)";
  const causeMessage = sanitizeSensitiveText(
    safeStringify(cause instanceof Error ? cause.message : cause),
  );

  return [
    "Falcon Deck error report (fallback - report generation itself failed)",
    `Build: ${buildId}`,
    `Time: ${timestamp}`,
    `Page: ${page}`,
    `Report generation error: ${causeMessage}`,
  ].join("\n");
}

/** The last resort: no dynamic content at all, so there is nothing left in it that could throw while building it. */
const INERT_FALLBACK_REPORT =
  "Falcon Deck error report unavailable - report generation failed. Please note what you were doing and reload.";

/**
 * Never throws: `componentDidCatch` has nowhere to send an exception raised
 * while handling an exception, so every step that could plausibly fail (a
 * hostile/malformed `error`, an unparseable `href`, even a failure inside
 * the fallback path itself) is contained here rather than left to the
 * caller.
 */
export function buildErrorReport(input: ErrorReportInput): string {
  try {
    return buildReportSections(input);
  } catch (cause) {
    try {
      return buildFallbackReport(input, cause);
    } catch {
      return INERT_FALLBACK_REPORT;
    }
  }
}
