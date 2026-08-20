/**
 * The Drive OAuth session: an access token (plus refresh token/expiry),
 * stored only in a server-side httpOnly, secure, SameSite=Lax cookie (set
 * by `app/api/drive/callback`) - never in localStorage, never sent to the
 * client as JSON. These helpers are pure (no cookie/request access) so
 * they're directly unit-testable; the route handlers are the only code
 * that actually reads/writes the cookie itself.
 */
export const DRIVE_SESSION_COOKIE = "falcon_deck_drive_session";
/** Short-lived CSRF guard for the OAuth redirect round-trip, cleared once the callback completes. */
export const DRIVE_OAUTH_STATE_COOKIE = "falcon_deck_drive_oauth_state";

export interface DriveSession {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export function serializeDriveSession(session: DriveSession): string {
  return JSON.stringify(session);
}

export function parseDriveSession(raw: string | undefined | null): DriveSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DriveSession>;
    if (typeof parsed.accessToken !== "string" || parsed.accessToken.length === 0) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

export function isDriveSessionValid(session: DriveSession | null): session is DriveSession {
  return session !== null && session.expiresAt > Date.now();
}
