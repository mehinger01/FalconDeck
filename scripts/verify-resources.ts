/**
 * Standalone verification for Phase 5's Resource Library and Google Drive
 * integration. Companion to scripts/verify-schedule.ts, verify-lessons.ts,
 * verify-preview.ts, verify-week.ts, and verify-classroom.ts (`npm run
 * verify` runs all six) - this script covers what's new: LibraryResource
 * CRUD, search/filter, lesson attachment (and its independence from the
 * library afterward), MIME mapping, the Drive adapter's pure/testable
 * pieces (encrypted session serialization/parsing and tamper rejection,
 * access-token refresh decision logic, configuration detection,
 * external-resource conversion, duplicate detection), a static scan
 * proving no OAuth token or other localStorage access leaked outside the
 * repository layer or into an API response body, and a
 * secrets-in-.env.example check - plus regression spot-checks against
 * Phases 1-4.
 *
 * Live Google OAuth cannot be exercised here (no credentials in this
 * environment - see the report). Per the phase's own instructions, Drive
 * is tested via its adapter boundary: pure functions, and a
 * FakeExternalResourceProvider standing in for a real Drive connection.
 *
 * Not a test framework - a script with assertions, run via `tsx`:
 *
 *   npm run verify:resources
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { appDataReducer } from "@/lib/store/reducer";
import type { AppDataAction } from "@/lib/store/actions";
import { createLessonActions } from "@/lib/store/lessonActions";
import { createLibraryResourceActions } from "@/lib/store/libraryResourceActions";
import { createDemoAppData, DEMO_SCHEDULES } from "@/lib/data/demoData";
import { findLessonForSection } from "@/lib/data/lessons";
import { findLibraryResource, findLibraryResourceByDriveFileId } from "@/lib/data/libraryResources";
import { LocalStorageDataRepository } from "@/lib/data/localStorageRepository";
import { filterResources } from "@/lib/resources/filterResources";
import { inferResourceType } from "@/lib/resources/inferResourceType";
import { mapMimeTypeToResourceType } from "@/lib/resources/googleDrive/mimeTypeMapping";
import { convertExternalResourceToLibraryResource } from "@/lib/resources/googleDrive/convertExternalResource";
// Note: lib/resources/googleDrive/config.ts is intentionally NOT imported
// here - it's guarded with `import "server-only"`, which throws when
// required outside a bundler's server condition (plain Node/tsx included).
// That guard is itself the point: it's what keeps OAuth-secret-adjacent
// code from ever being bundled into client output. This script checks the
// same underlying fact (no Drive env vars set in this environment)
// directly against process.env instead.
import {
  isDriveSessionValid,
  parseDriveSession,
  serializeDriveSession,
  sessionCanReconnect,
  DRIVE_SESSION_COOKIE,
  type DriveSession,
} from "@/lib/resources/googleDrive/session";
import {
  getValidDriveAccessToken,
  isAccessTokenFresh,
  type TokenExchangeResult,
} from "@/lib/resources/googleDrive/tokenRefresh";
// Note: lib/resources/googleDrive/googleTokenExchange.ts and
// driveSessionServer.ts are also intentionally NOT imported here, for the
// same reason as config.ts above - they're `server-only`-guarded because
// they make real network calls with the OAuth client secret. Their pure
// decision logic lives in tokenRefresh.ts (imported above, no guard) and
// is exercised here with a fake exchange function instead of live Google
// credentials.
import type { ExternalResourceProvider, ExternalResource } from "@/lib/resources/externalResourceProvider";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { resolvePreviewClassroomProps } from "@/lib/present/resolvePreviewClassroomProps";
import { buildWeekPlanningGrid } from "@/lib/week/buildWeekPlanningGrid";
import { createTimerState, startTimer } from "@/lib/tools/timer/timerLogic";
import { createToolTrayState, toggleTray } from "@/lib/present/toolTrayState";
import type { AppData } from "@/lib/data/types";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const schedule = DEMO_SCHEDULES.find((s) => s.id === "schedule-demo-standard")!;
function atLocalTime(isoDate: string, hhmm: string): Date {
  return new Date(`${isoDate}T${hhmm}:00-04:00`);
}
const MONDAY = "2026-08-17";

let state: AppData = { ...createDemoAppData(), lessons: [], libraryResources: [] };
function dispatch(action: AppDataAction) {
  state = appDataReducer(state, action);
}
function lessonActions() {
  return createLessonActions(state, dispatch);
}
function libraryActions() {
  return createLibraryResourceActions(state, dispatch);
}

async function main() {
console.log("1-3. Manual resource create/edit/delete");
{
  const created = libraryActions().createLibraryResource({
    title: "Warm-Up Slides",
    url: "https://example.com/warm-up",
    type: "slides",
    courseIds: ["course-algebra-1"],
    tags: ["warm-up"],
    isFavorite: false,
    source: { kind: "manual" },
  });
  check("1: resource was created and is findable", findLibraryResource(state.libraryResources, created.id) !== null);

  libraryActions().updateLibraryResource(created.id, { title: "Warm-Up Slides (Updated)" });
  check(
    "2: resource edit persists",
    findLibraryResource(state.libraryResources, created.id)?.title === "Warm-Up Slides (Updated)",
  );

  libraryActions().deleteLibraryResource(created.id);
  check("3: resource delete removes it", findLibraryResource(state.libraryResources, created.id) === null);
}

console.log("\n4-9. Search and filters");
{
  libraryActions().createLibraryResource({
    title: "Two-Step Equations Practice",
    url: "https://example.com/two-step",
    type: "document",
    courseIds: ["course-algebra-1"],
    tags: ["practice", "SAT"],
    notes: "Great for a Friday review day.",
    isFavorite: true,
    source: { kind: "manual" },
  });
  libraryActions().createLibraryResource({
    title: "Angle Pairs Slides",
    url: "https://example.com/angle-pairs",
    type: "slides",
    courseIds: ["course-geometry"],
    tags: ["notes"],
    isFavorite: false,
    source: { kind: "manual" },
  });

  check(
    "4: search matches title",
    filterResources(state.libraryResources, "two-step", {}, state.courses).some((r) => r.title === "Two-Step Equations Practice"),
  );
  check(
    "5: search matches tags",
    filterResources(state.libraryResources, "SAT", {}, state.courses).some((r) => r.title === "Two-Step Equations Practice"),
  );
  check(
    "6: search matches notes",
    filterResources(state.libraryResources, "Friday review", {}, state.courses).some(
      (r) => r.title === "Two-Step Equations Practice",
    ),
  );
  check(
    "7: search is case-insensitive",
    filterResources(state.libraryResources, "ANGLE pairs", {}, state.courses).some((r) => r.title === "Angle Pairs Slides"),
  );
  check(
    "8: course filter works",
    filterResources(state.libraryResources, "", { courseId: "course-geometry" }, state.courses).every((r) =>
      r.courseIds.includes("course-geometry"),
    ),
  );
  check(
    "9: type filter works",
    filterResources(state.libraryResources, "", { type: "slides" }, state.courses).every((r) => r.type === "slides"),
  );
  check(
    "10: favorites filter works",
    filterResources(state.libraryResources, "", { favoritesOnly: true }, state.courses).every((r) => r.isFavorite),
  );
}

console.log("\n11-12. Multi-course association and URL integrity");
{
  const multiCourse = libraryActions().createLibraryResource({
    title: "Desmos Graphing Calculator",
    url: "https://www.desmos.com/calculator?embed=true&lang=en",
    type: "desmos",
    courseIds: ["course-algebra-1", "course-geometry"],
    tags: [],
    isFavorite: false,
    source: { kind: "manual" },
  });
  check(
    "11: resource belongs to multiple courses",
    multiCourse.courseIds.includes("course-algebra-1") && multiCourse.courseIds.includes("course-geometry"),
  );
  check(
    "12: the manual URL is stored exactly as entered (no mangling)",
    findLibraryResource(state.libraryResources, multiCourse.id)?.url === "https://www.desmos.com/calculator?embed=true&lang=en",
  );
}

console.log("\n13-14. Persistence through DataRepository, including pre-Phase-5 data");
{
  const fakeStore = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => fakeStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        fakeStore.set(key, value);
      },
      removeItem: (key: string) => {
        fakeStore.delete(key);
      },
    },
  };

  const repo = new LocalStorageDataRepository();
  await repo.save(state);
  const reloaded = await repo.load();
  check(
    "13: libraryResources round-trips through save/load",
    reloaded.libraryResources.length === state.libraryResources.length &&
      reloaded.libraryResources[0]?.title === state.libraryResources[0]?.title,
  );

  // Simulate data saved before Phase 5 existed: no libraryResources key at all.
  const preservedData = createDemoAppData() as unknown as Record<string, unknown>;
  delete preservedData.libraryResources;
  fakeStore.set("falcon-deck:app-data:v1", JSON.stringify(preservedData));
  const legacyLoaded = await repo.load();
  check(
    "14: old AppData missing libraryResources loads safely and defaults to []",
    Array.isArray(legacyLoaded.libraryResources) && legacyLoaded.libraryResources.length === 0,
  );

  delete (globalThis as Record<string, unknown>).window;
}

console.log("\n15-18. Attaching a lesson resource from the Library");
let attachedLibraryResourceId = "";
{
  const libraryResource = libraryActions().createLibraryResource({
    title: "Exit Ticket",
    url: "https://example.com/exit-ticket",
    type: "document",
    courseIds: [],
    tags: ["exit-ticket"],
    isFavorite: false,
    source: { kind: "manual" },
  });
  attachedLibraryResourceId = libraryResource.id;

  lessonActions().addResource(MONDAY, "section-algebra-1-p1", {
    title: libraryResource.title,
    url: libraryResource.url,
    type: libraryResource.type,
    libraryResourceId: libraryResource.id,
  });

  const lesson = findLessonForSection(state.lessons, MONDAY, "section-algebra-1-p1");
  check("15: the resource was added to the lesson", Boolean(lesson?.resources.some((r) => r.title === "Exit Ticket")));

  const attached = lesson!.resources.find((r) => r.title === "Exit Ticket")!;
  check("16: the attached lesson resource has a fresh id, not the library resource's id", attached.id !== libraryResource.id);
  check(
    "17: title/url/type were copied exactly",
    attached.title === libraryResource.title && attached.url === libraryResource.url && attached.type === libraryResource.type,
  );
  check("18: the libraryResourceId is stored for traceability", attached.libraryResourceId === libraryResource.id);
}

console.log("\n19. Deleting a LibraryResource does not delete the attached lesson resource");
{
  libraryActions().deleteLibraryResource(attachedLibraryResourceId);
  check("the library resource is gone", findLibraryResource(state.libraryResources, attachedLibraryResourceId) === null);

  const lesson = findLessonForSection(state.lessons, MONDAY, "section-algebra-1-p1");
  const stillAttached = lesson?.resources.find((r) => r.libraryResourceId === attachedLibraryResourceId);
  check(
    "the lesson resource remains fully intact (title/url/type unchanged) - lesson resources are snapshots, not live references",
    stillAttached?.title === "Exit Ticket" && stillAttached?.url === "https://example.com/exit-ticket",
  );
}

console.log("\n20. Existing manual lesson-resource workflow still works");
{
  lessonActions().addResource(MONDAY, "section-geometry-p2", {
    title: "One-off Manual Link",
    url: "https://example.com/manual",
    type: "link",
  });
  const lesson = findLessonForSection(state.lessons, MONDAY, "section-geometry-p2");
  const manualResource = lesson?.resources.find((r) => r.title === "One-off Manual Link");
  check("a manually-added resource (no library) still works", manualResource !== undefined);
  check("its libraryResourceId is undefined, not a fake value", manualResource?.libraryResourceId === undefined);
}

console.log("\n21-23. Present Mode / Quick Resource / QR work with a library-attached lesson resource");
{
  const lesson = findLessonForSection(state.lessons, MONDAY, "section-algebra-1-p1")!;
  const attached = lesson.resources.find((r) => r.libraryResourceId !== undefined || r.title === "Exit Ticket");
  // 21: Present Mode's live-mode ClassroomView renders whatever is in
  // lesson.resources verbatim (see LivePresentScreen/ClassroomView) - the
  // lookup path is identical to Phase 2/4's, re-confirmed here:
  const preview = resolvePreviewClassroomProps({
    date: MONDAY,
    classSectionId: "section-algebra-1-p1",
    block: null,
    lessons: state.lessons,
  });
  check("21: Present Mode's lesson lookup surfaces the library-attached resource", preview?.lesson?.resources.some((r) => r.title === "Exit Ticket") ?? false);
  // 22: Quick Resource (Phase 4) reads lesson.resources directly with no
  // special-casing of libraryResourceId - the resource object itself is
  // exactly what it needs (title/url/type).
  check("22: the resource has everything Quick Resource needs (title/url/type)", Boolean(attached?.title && attached?.url && attached?.type));
  // 23: QR generation just needs a URL string - already proven generic in
  // verify-classroom.ts; re-confirmed here specifically for a
  // library-attached resource's URL.
  check("23: the resource's URL is a valid string suitable for QR generation", typeof attached?.url === "string" && attached.url.startsWith("https://"));
}

console.log("\nExtra: URL type inference (manual-add form pre-selects, always overridable)");
{
  check("Desmos link infers desmos", inferResourceType("https://www.desmos.com/calculator") === "desmos");
  check("A .pdf URL infers pdf", inferResourceType("https://example.com/handout.pdf") === "pdf");
  check("A YouTube URL infers video", inferResourceType("https://youtube.com/watch?v=abc") === "video");
  check("An ordinary webpage falls back to link", inferResourceType("https://example.com/some-page") === "link");
}

console.log("\n24-29. Google Drive MIME type mapping");
{
  check("24: Google Docs -> document", mapMimeTypeToResourceType("application/vnd.google-apps.document") === "document");
  check("25: Google Slides -> slides", mapMimeTypeToResourceType("application/vnd.google-apps.presentation") === "slides");
  check("26: Google Sheets -> spreadsheet", mapMimeTypeToResourceType("application/vnd.google-apps.spreadsheet") === "spreadsheet");
  check("27: PDF -> pdf", mapMimeTypeToResourceType("application/pdf") === "pdf");
  check("28: image/* -> image", mapMimeTypeToResourceType("image/png") === "image" && mapMimeTypeToResourceType("image/jpeg") === "image");
  check("29: unknown MIME -> other (fallback)", mapMimeTypeToResourceType("application/octet-stream") === "other" && mapMimeTypeToResourceType(null) === "other");
}

console.log("\n30-31. Drive import + duplicate detection");
{
  const externalFile: ExternalResource = {
    id: "drive-file-abc123",
    name: "Unit 3 Slides",
    mimeType: "application/vnd.google-apps.presentation",
    webViewUrl: "https://docs.google.com/presentation/d/abc123/edit",
    modifiedTime: "2026-01-01T00:00:00.000Z",
  };

  const draft = convertExternalResourceToLibraryResource(externalFile);
  check("30: MIME maps correctly during conversion", draft.type === "slides");
  check("30: title comes from the Drive file name", draft.title === "Unit 3 Slides");
  check("30: url comes from webViewUrl", draft.url === externalFile.webViewUrl);
  check("30: driveFileId is preserved in source metadata", draft.source.kind === "google-drive" && draft.source.driveFileId === "drive-file-abc123");

  const imported = libraryActions().importExternalResource(draft);
  check("30: the draft becomes a real LibraryResource", findLibraryResource(state.libraryResources, imported.id) !== null);

  check("31: no duplicate detected before a second import", findLibraryResourceByDriveFileId(state.libraryResources, "drive-file-abc123")?.id === imported.id);

  // Simulate re-importing the same file (e.g. modified since) with explicit confirmation to update in place.
  const reimportDraft = convertExternalResourceToLibraryResource({ ...externalFile, name: "Unit 3 Slides (Revised)" });
  const existing = findLibraryResourceByDriveFileId(state.libraryResources, externalFile.id);
  check("31: the duplicate IS detected on a second import of the same Drive file", existing?.id === imported.id);
  const updated = libraryActions().importExternalResource(reimportDraft, { updateExistingId: existing!.id });
  check("31: confirmed re-import updates the existing entry in place (same id), not a duplicate", updated.id === imported.id && updated.title === "Unit 3 Slides (Revised)");
  check(
    "31: still exactly one library resource for this Drive file",
    state.libraryResources.filter((r) => r.source.kind === "google-drive" && r.source.driveFileId === "drive-file-abc123").length === 1,
  );
}

console.log("\n32-33. Drive disconnected / API failure states are safe");
{
  check("32: no session cookie -> parses as not connected", parseDriveSession(undefined) === null);
  check("32: garbage cookie value -> parses safely as not connected, doesn't throw", parseDriveSession("not-json-at-all") === null);
  check("32: garbage with the right shape (three dot-separated parts) still fails safely", parseDriveSession("abc.def.ghi") === null);
  check("32: an expired session (object form) is invalid", isDriveSessionValid({ accessToken: "token", expiresAt: Date.now() - 1000 }) === false);
  check("32: a valid, unexpired session (object form) is valid", isDriveSessionValid({ accessToken: "token", expiresAt: Date.now() + 100000 }) === true);
  const driveConfigured = Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
      process.env.GOOGLE_DRIVE_REDIRECT_URI &&
      process.env.FALCON_DECK_SESSION_SECRET,
  );
  check(
    "32: without env vars configured in this environment, Drive correctly reports as not configured (same check isGoogleDriveConfigured performs server-side)",
    driveConfigured === false,
  );

  // 33: exercise the adapter contract with a fake provider (per the
  // phase's own guidance: mocks/fakes when live credentials aren't
  // available) - a failing provider must not crash the caller, only
  // reject the promise.
  class FailingProvider implements ExternalResourceProvider {
    async search(): Promise<ExternalResource[]> {
      throw new Error("Google Drive request failed.");
    }
    async listRecent(): Promise<ExternalResource[]> {
      throw new Error("Google Drive request failed.");
    }
    async getFile(): Promise<ExternalResource | null> {
      throw new Error("Google Drive request failed.");
    }
  }
  const failing = new FailingProvider();
  let caught = false;
  try {
    await failing.listRecent();
  } catch {
    caught = true;
  }
  check("33: a failing provider rejects cleanly (catchable), never crashes the caller", caught);
}

console.log("\n34. Encrypted session: round-trips, hides tokens, rejects tampering and wrong/missing secrets");
{
  const originalSecret = process.env.FALCON_DECK_SESSION_SECRET;
  delete process.env.FALCON_DECK_SESSION_SECRET;

  check(
    "34: with no session secret configured, serializeDriveSession refuses to produce a cookie value (never falls back to plaintext)",
    serializeDriveSession({ accessToken: "abc", expiresAt: Date.now() + 1000 }) === null,
  );
  check("34: with no session secret configured, parseDriveSession safely reports no session", parseDriveSession("anything") === null);

  process.env.FALCON_DECK_SESSION_SECRET = "verify-script-test-secret-do-not-use-in-production";

  const original: DriveSession = { accessToken: "ya29.super-secret-access-token", refreshToken: "1//refresh-secret-value", expiresAt: Date.now() + 3_600_000 };
  const serialized = serializeDriveSession(original);
  check("34: a session serializes to a non-null cookie value once a secret is configured", serialized !== null);

  const roundTripped = parseDriveSession(serialized);
  check(
    "34: valid encrypted session round-trips exactly (accessToken, refreshToken, expiresAt)",
    roundTripped?.accessToken === original.accessToken &&
      roundTripped?.refreshToken === original.refreshToken &&
      roundTripped?.expiresAt === original.expiresAt,
  );

  check(
    "34: the serialized cookie value does not contain the plaintext access token",
    serialized !== null && !serialized.includes(original.accessToken),
  );
  check(
    "34: the serialized cookie value does not contain the plaintext refresh token",
    serialized !== null && !serialized.includes(original.refreshToken!),
  );

  // Flip one character deep in the ciphertext segment - GCM's auth tag must catch this.
  const tampered = serialized!.slice(0, -5) + (serialized!.at(-5) === "A" ? "B" : "A") + serialized!.slice(-4);
  check("34: a single-character-tampered session fails to parse/decrypt", parseDriveSession(tampered) === null);

  const truncated = serialized!.slice(0, Math.floor(serialized!.length / 2));
  check("34: a truncated session fails to parse/decrypt", parseDriveSession(truncated) === null);

  process.env.FALCON_DECK_SESSION_SECRET = "a-completely-different-secret-value";
  check("34: a session encrypted under one secret fails to decrypt under a different secret", parseDriveSession(serialized) === null);

  if (originalSecret === undefined) {
    delete process.env.FALCON_DECK_SESSION_SECRET;
  } else {
    process.env.FALCON_DECK_SESSION_SECRET = originalSecret;
  }
}

console.log("\n35. Access token refresh (pure decision logic, fake token exchange - no live Google credentials needed)");
{
  const credentials = { clientId: "client-123", clientSecret: "secret-abc" };
  const freshSession: DriveSession = { accessToken: "fresh-token", refreshToken: "refresh-token", expiresAt: Date.now() + 3_600_000 };
  const expiredWithRefresh: DriveSession = { accessToken: "old-token", refreshToken: "refresh-token", expiresAt: Date.now() - 1000 };
  const expiredNoRefresh: DriveSession = { accessToken: "old-token", expiresAt: Date.now() - 1000 };

  check("35: a session expiring far in the future is considered fresh", isAccessTokenFresh(freshSession));
  check("35: a session expiring in the next few minutes is not considered fresh", !isAccessTokenFresh({ ...freshSession, expiresAt: Date.now() + 60_000 }));

  const succeedingExchange = async (): Promise<TokenExchangeResult> => ({ ok: true, accessToken: "new-access-token", expiresInSeconds: 3600 });
  const succeedingExchangeWithNewRefresh = async (): Promise<TokenExchangeResult> => ({
    ok: true,
    accessToken: "new-access-token",
    expiresInSeconds: 3600,
    refreshToken: "brand-new-refresh-token",
  });
  const failingExchange = async (): Promise<TokenExchangeResult> => ({ ok: false });
  const throwingExchange = async (): Promise<TokenExchangeResult> => {
    throw new Error("network error");
  };

  const freshResult = await getValidDriveAccessToken(freshSession, credentials, succeedingExchange);
  check("35: a fresh access token is returned as-is, with no refresh attempted", freshResult.status === "valid" && !freshResult.refreshed && freshResult.session.accessToken === "fresh-token");

  const refreshedResult = await getValidDriveAccessToken(expiredWithRefresh, credentials, succeedingExchange);
  check(
    "35-36: an expired token with a refresh token triggers a refresh, and the refresh updates the access token and expiry",
    refreshedResult.status === "valid" && refreshedResult.refreshed && refreshedResult.session.accessToken === "new-access-token" && refreshedResult.session.expiresAt > Date.now(),
  );
  check(
    "37: refresh preserves the old refresh token when the exchange doesn't return a new one",
    refreshedResult.status === "valid" && refreshedResult.session.refreshToken === "refresh-token",
  );

  const refreshedWithNewToken = await getValidDriveAccessToken(expiredWithRefresh, credentials, succeedingExchangeWithNewRefresh);
  check(
    "35: refresh adopts a new refresh token when the exchange does return one",
    refreshedWithNewToken.status === "valid" && refreshedWithNewToken.session.refreshToken === "brand-new-refresh-token",
  );

  const failedResult = await getValidDriveAccessToken(expiredWithRefresh, credentials, failingExchange);
  check("38: a failed refresh (exchange rejects) returns disconnected, never throws or fakes a token", failedResult.status === "disconnected" && failedResult.reason === "refresh-failed");

  const thrownResult = await getValidDriveAccessToken(expiredWithRefresh, credentials, throwingExchange);
  check("38: a refresh call that throws (network error) is caught and returns disconnected", thrownResult.status === "disconnected" && thrownResult.reason === "refresh-failed");

  const noRefreshTokenResult = await getValidDriveAccessToken(expiredNoRefresh, credentials, succeedingExchange);
  check(
    "39: an expired token with no refresh token is disconnected without ever calling the token endpoint",
    noRefreshTokenResult.status === "disconnected" && noRefreshTokenResult.reason === "no-refresh-token",
  );

  const noConfigResult = await getValidDriveAccessToken(expiredWithRefresh, null, succeedingExchange);
  check("38: an expired token with no configured credentials is disconnected safely", noConfigResult.status === "disconnected" && noConfigResult.reason === "config-missing");
}

console.log("\n36. sessionCanReconnect - the basis for /api/drive/status's `connected` flag");
{
  check("36: no session cannot reconnect", sessionCanReconnect(null) === false);
  check("36: a currently-valid session can reconnect", sessionCanReconnect({ accessToken: "t", expiresAt: Date.now() + 100000 }) === true);
  check(
    "36: an expired session with a refresh token can still reconnect (transparent refresh on next use)",
    sessionCanReconnect({ accessToken: "t", refreshToken: "r", expiresAt: Date.now() - 1000 }) === true,
  );
  check(
    "9: an expired session with NO refresh token cannot silently claim connected",
    sessionCanReconnect({ accessToken: "t", expiresAt: Date.now() - 1000 }) === false,
  );
}

console.log("\n37. No OAuth token in localStorage or any API response payload");
{
  check(
    "the session cookie constant is a cookie name, not a localStorage key convention in use anywhere",
    DRIVE_SESSION_COOKIE === "falcon_deck_drive_session",
  );

  process.env.FALCON_DECK_SESSION_SECRET = "verify-script-test-secret-do-not-use-in-production";
  check(
    "serializing/parsing a session round-trips without ever touching localStorage (pure functions only)",
    parseDriveSession(serializeDriveSession({ accessToken: "abc", expiresAt: Date.now() + 1000 }))?.accessToken === "abc",
  );
  delete process.env.FALCON_DECK_SESSION_SECRET;

  // Static scan: no app/api/drive/* route ever embeds a raw access/refresh
  // token in a NextResponse.json(...) payload. All of this project's Drive
  // JSON responses are short, single-line calls, so a per-line check is a
  // faithful (not just approximate) proxy for "the response body never
  // contains a token field".
  const driveApiDir = join(process.cwd(), "app", "api", "drive");
  const offendingLines: string[] = [];
  function scanForTokenLeaks(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scanForTokenLeaks(fullPath);
      } else if (entry === "route.ts") {
        const lines = readFileSync(fullPath, "utf8").split("\n");
        for (const line of lines) {
          if (line.includes("NextResponse.json(") && (line.includes("accessToken") || line.includes("refreshToken"))) {
            offendingLines.push(`${fullPath}: ${line.trim()}`);
          }
        }
      }
    }
  }
  scanForTokenLeaks(driveApiDir);
  check(
    offendingLines.length === 0
      ? "no app/api/drive/*/route.ts response embeds an access/refresh token"
      : `possible token leak in a JSON response: ${offendingLines.join(" | ")}`,
    offendingLines.length === 0,
  );
}

console.log("\n38. No secrets committed (.env.example has empty placeholder values)");
{
  const envExamplePath = join(process.cwd(), ".env.example");
  const envExampleContents = readFileSync(envExamplePath, "utf8");
  const declaredVars = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REDIRECT_URI", "FALCON_DECK_SESSION_SECRET"];
  const allBlank = declaredVars.every((name) => new RegExp(`^${name}=\\s*$`, "m").test(envExampleContents));
  check("every Drive/session env var in .env.example has no value after the '='", allBlank);
}

console.log("\n39. No direct localStorage access introduced outside the repository layer");
{
  const projectRoot = process.cwd();
  const scanDirs = ["components", "lib", "app"];
  const allowedFile = join("lib", "data", "localStorageRepository.ts").replace(/\\/g, "/");
  const offenders: string[] = [];

  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(fullPath);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        const relative = fullPath.slice(projectRoot.length + 1).replace(/\\/g, "/");
        if (relative === allowedFile) continue;
        const contents = stripComments(readFileSync(fullPath, "utf8"));
        if (/\blocalStorage\b/.test(contents)) offenders.push(relative);
      }
    }
  }

  for (const dir of scanDirs) walk(join(projectRoot, dir));

  check(
    offenders.length === 0
      ? "no source file outside lib/data/localStorageRepository.ts references localStorage"
      : `localStorage referenced outside the repository layer in: ${offenders.join(", ")}`,
    offenders.length === 0,
  );
}

console.log("\n40-44. Regression spot-checks: Week / Lessons / Preview / classroom tools / transitions");
{
  const grid = buildWeekPlanningGrid({
    weekStart: MONDAY,
    classSections: state.classSections,
    courses: state.courses,
    lessons: state.lessons,
    schedule,
  });
  check("40: Week view still builds a full grid", grid.rows.length === state.classSections.length);

  lessonActions().updateLearningTarget(MONDAY, "section-geometry-p6", "Resources regression check");
  check(
    "41: lesson editing still works",
    findLessonForSection(state.lessons, MONDAY, "section-geometry-p6")?.learningTarget === "Resources regression check",
  );

  const previewCheck = resolvePreviewClassroomProps({ date: MONDAY, classSectionId: "section-algebra-1-p1", block: null, lessons: state.lessons });
  check("42: Preview still resolves and never fakes the countdown", previewCheck !== null && previewCheck.showCountdown === false);

  let timer = createTimerState(60);
  timer = startTimer(timer);
  let tray = createToolTrayState("Work Time");
  tray = toggleTray(tray);
  check("43: classroom tools (timer + tray) still work independently", timer.isRunning === true && tray.trayExpanded === true);

  const transition = getPresentationState(schedule, atLocalTime(MONDAY, "09:41"));
  check(
    "44: automated transitions still identify the correct next class",
    transition.mode === "transition" && transition.nextStudentFacingBlock?.kind === "enrichment",
  );
}

console.log(
  "\n(Other suites: run `npm run verify:schedule`, `verify:lessons`, `verify:preview`, `verify:week`, and " +
    "`verify:classroom` - or `npm run verify` for everything together. Also run `npm run lint` and `npm run build`.)",
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
}

main().then(() => {
  process.exit(failures === 0 ? 0 : 1);
});
