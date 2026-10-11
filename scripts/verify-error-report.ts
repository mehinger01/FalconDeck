/**
 * Standalone verification for `buildErrorReport`/`redactSensitiveQueryParams`
 * (lib/diagnostics/errorReport.ts) - the plain-text diagnostic report
 * `FalconErrorBoundary` shows and lets a teacher copy once automatic
 * recovery gives up, for use on school-managed Chrome profiles where
 * DevTools is locked down.
 *
 * Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npx tsx scripts/verify-error-report.ts
 */

import { buildErrorReport, redactSensitiveQueryParams } from "@/lib/diagnostics/errorReport";
import type { ErrorReportInput } from "@/lib/diagnostics/errorReport";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const baseInput: ErrorReportInput = {
  error: new Error("placeholder"),
  componentStack: null,
  href: "https://app.example.com/present",
  userAgent: "Mozilla/5.0 (test)",
  timestamp: "2026-10-06T12:00:00.000Z",
  attemptNumber: 1,
  maxAttempts: 4,
  buildId: "a1b2c3d",
};

console.log("1. The URL redactor is an ALLOWLIST, not a blocklist - anything unlisted is redacted by default");
{
  const allAllowed =
    "https://app.example.com/present?mode=preview&date=2026-10-06&section=section-abc123&block=block-1&course=course-1";
  check(
    "every param this app's own routes actually use passes through unchanged",
    redactSensitiveQueryParams(allAllowed) === "/present?mode=preview&date=2026-10-06&section=section-abc123&block=block-1&course=course-1",
  );

  const unlistedButInnocuous = "https://app.example.com/present?mode=preview&foo=bar";
  const redacted = redactSensitiveQueryParams(unlistedButInnocuous);
  check(
    "an unlisted param is redacted even when its NAME isn't credential-shaped - proves deny-by-default, not a blocklist",
    redacted.includes("foo=%5Bredacted%5D") || redacted.includes("foo=[redacted]"),
  );
  check("the allowed param alongside it is untouched", redacted.includes("mode=preview"));
}

console.log("\n2. Credential-shaped query keys are redacted (also covered by the allowlist, kept as a direct check)");
{
  const href =
    "https://app.example.com/auth/callback?code=abc.def.ghi&state=xyz&access_token=secret1&refresh_token=secret2&apikey=k";
  const redacted = redactSensitiveQueryParams(href);
  check("code is redacted", redacted.includes("code=%5Bredacted%5D") || redacted.includes("code=[redacted]"));
  check("access_token is redacted", !redacted.includes("secret1"));
  check("refresh_token is redacted", !redacted.includes("secret2"));
  check("apikey is redacted", !redacted.includes("apikey=k"));
  check("no raw secret value survives in the redacted string", !redacted.includes("secret1") && !redacted.includes("secret2"));
}

console.log("\n3. An unparseable href never throws - falls back to a placeholder");
{
  check("malformed href degrades gracefully", redactSensitiveQueryParams("not a url") === "[unavailable]");
}

console.log("\n4. buildErrorReport never includes anything beyond what it was explicitly given");
{
  const report = buildErrorReport({
    ...baseInput,
    error: new TypeError("Cannot read properties of undefined (reading 'length')"),
    componentStack: "\n    at LessonPanels\n    at ClassroomView\n    at PreviewPresentScreen",
    href: "https://app.example.com/present?mode=preview&date=2026-10-06&section=section-abc123&token=secret",
    attemptNumber: 4,
  });

  check("includes the error name and message", report.includes("TypeError: Cannot read properties of undefined"));
  check("includes the component stack", report.includes("LessonPanels") && report.includes("PreviewPresentScreen"));
  check("includes the timestamp", report.includes("2026-10-06T12:00:00.000Z"));
  check("includes the retry attempt count", report.includes("attempt 4 of 4"));
  check("includes the build id, so a report can be matched to the deploy it came from", report.includes("Build: a1b2c3d"));
  check("the query string is redacted inside the report too", !report.includes("token=secret"));
  check("never mentions lesson/agenda/resource content - this function receives none", !/learning target|agenda|resource/i.test(report));
}

console.log("\n5. A non-Error throw (e.g. a thrown string) still produces a usable report");
{
  const report = buildErrorReport({
    ...baseInput,
    error: "a plain string throw",
    componentStack: null,
  });
  check("falls back to UnknownError for a non-Error throw", report.includes("UnknownError: a plain string throw"));
  check("missing component stack is reported explicitly, not left blank", report.includes("(no component stack available)"));
}

console.log("\n6. Secrets embedded INSIDE an error message (free text, not a query param) are redacted");
{
  const fakeJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const bareFakeJwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.YnJhbmNoLW5vdC1hLXJlYWwtc2lnbmF0dXJl";
  const report = buildErrorReport({
    ...baseInput,
    error: new Error(
      `Supabase request failed: Authorization: Bearer ${fakeJwt} - cached anon key ${bareFakeJwt} - token=plainOpaqueSecret123 code=oauth-code-xyz session: sess_live_abc789`,
    ),
  });

  check("the raw Bearer-prefixed JWT never appears in the report", !report.includes(fakeJwt));
  check("the raw bare (not Bearer-prefixed) JWT never appears either", !report.includes(bareFakeJwt));
  check(
    "a bare JWT with no 'Bearer ' prefix is still caught and redacted on its own",
    report.includes("[redacted-jwt]"),
  );
  check("the Bearer header value is redacted", !report.includes(`Bearer ${fakeJwt}`) && report.includes("Bearer [redacted]"));
  check("a plain `token=...` assignment is redacted", !report.includes("plainOpaqueSecret123") && /token=\[redacted\]/i.test(report));
  check("a plain `code=...` assignment is redacted (the OAuth-callback shape)", !report.includes("oauth-code-xyz") && /code=\[redacted\]/i.test(report));
  check("a `session: ...` assignment is redacted", !report.includes("sess_live_abc789") && /session=\[redacted\]/i.test(report));
}

console.log("\n7. Secrets embedded in error.stack and in the React component stack are redacted too");
{
  const report = buildErrorReport({
    ...baseInput,
    error: (() => {
      const err = new Error("fetch failed");
      err.stack = "Error: fetch failed\n    at fetchLessons (apikey=sk_live_abcdef123456:12:3)";
      return err;
    })(),
    componentStack: "\n    at Boom (secret=do-not-leak-this)\n    at FalconErrorBoundary",
  });

  check("a secret embedded in error.stack is redacted", !report.includes("sk_live_abcdef123456") && /apikey=\[redacted\]/i.test(report));
  check("a secret embedded in the component stack is redacted", !report.includes("do-not-leak-this") && /secret=\[redacted\]/i.test(report));
  check("the component stack's actual frame names still survive (only the secret is stripped)", report.includes("FalconErrorBoundary"));
}

console.log("\n7b. A secret embedded in error.name (a custom Error subclass can set this to arbitrary text) is redacted too");
{
  const hostileNameError = new Error("plain message");
  hostileNameError.name = "token=do-not-leak-this-either";
  const report = buildErrorReport({ ...baseInput, error: hostileNameError });

  check(
    "a secret embedded in error.name is redacted, not just message/stack/component stack",
    !report.includes("do-not-leak-this-either") && /token=\[redacted\]/i.test(report),
  );
}

console.log("\n8. A hostile Error whose own fields throw on access never breaks report generation");
{
  const throwingMessageError = new Error("placeholder");
  Object.defineProperty(throwingMessageError, "message", {
    get() {
      throw new Error("message getter boom");
    },
  });
  const report1 = buildErrorReport({ ...baseInput, error: throwingMessageError });
  check("a throwing `message` getter doesn't propagate - buildErrorReport still returns a string", typeof report1 === "string" && report1.length > 0);

  const throwingStackError = new Error("stack getter test");
  Object.defineProperty(throwingStackError, "stack", {
    get() {
      throw new Error("stack getter boom");
    },
  });
  const report2 = buildErrorReport({ ...baseInput, error: throwingStackError });
  check("a throwing `stack` getter doesn't propagate", typeof report2 === "string" && report2.length > 0);
  check("falls back to '(no stack available)' when the stack can't be read", report2.includes("(no stack available)"));

  const throwingNameError = new Error("name getter test");
  Object.defineProperty(throwingNameError, "name", {
    get() {
      throw new Error("name getter boom");
    },
  });
  const report3 = buildErrorReport({ ...baseInput, error: throwingNameError });
  check("a throwing `name` getter doesn't propagate", typeof report3 === "string" && report3.length > 0);
  check("falls back to UnknownError when the name can't be read", report3.includes("UnknownError"));

  const throwingToStringValue = { toString: () => { throw new Error("toString boom"); } };
  const report4 = buildErrorReport({ ...baseInput, error: throwingToStringValue });
  check("a non-Error throw whose toString() itself throws doesn't propagate", typeof report4 === "string" && report4.length > 0);
}

console.log("\n9. Even a catastrophic failure inside report generation itself degrades to a fixed, non-throwing string");
{
  // A Proxy whose every property access throws - simulates `input` itself
  // being unusable, which would otherwise make both the primary path AND
  // the first fallback throw while trying to read e.g. `buildId`/`href`.
  const hostileInput = new Proxy(
    {},
    {
      get() {
        throw new Error("input access boom");
      },
    },
  ) as unknown as ErrorReportInput;

  let threw = false;
  let report = "";
  try {
    report = buildErrorReport(hostileInput);
  } catch {
    threw = true;
  }
  check("buildErrorReport NEVER throws, even when every field access on its input throws", !threw);
  check("it still returns a non-empty string in the worst case", typeof report === "string" && report.length > 0);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
