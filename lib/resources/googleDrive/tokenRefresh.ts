import type { DriveSession } from "@/lib/resources/googleDrive/session";

/**
 * The refresh *decision logic*, factored out from the network call itself
 * so it's directly unit-testable (scripts/verify-resources.ts exercises
 * it with a fake `exchangeRefreshToken`) without needing real Google
 * credentials or reaching into a `server-only`-guarded module. The real
 * caller (lib/resources/googleDrive/driveSessionServer.ts, which IS
 * server-only) supplies the actual `fetch`-based exchange function.
 */

/** Refresh once fewer than this much time remains, not only once already expired - avoids a request that fails Google-side by a few seconds of clock skew. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface RefreshCredentials {
  clientId: string;
  clientSecret: string;
}

export interface TokenExchangeResult {
  ok: boolean;
  accessToken?: string;
  expiresInSeconds?: number;
  /** Google omits this when the refresh token itself didn't change - callers must keep the old one in that case. */
  refreshToken?: string;
}

export type TokenExchange = (params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}) => Promise<TokenExchangeResult>;

export type DriveTokenOutcome =
  | { status: "valid"; session: DriveSession; refreshed: boolean }
  | { status: "disconnected"; reason: "no-refresh-token" | "config-missing" | "refresh-failed" };

export function isAccessTokenFresh(session: DriveSession, now: number = Date.now()): boolean {
  return session.expiresAt - now > REFRESH_MARGIN_MS;
}

/**
 * 1. Access token has reasonable time left -> return it as-is.
 * 2. Otherwise, with a refresh token -> exchange it for a new access token.
 * 3. Refresh succeeds -> new access token + expiry, old refresh token kept
 *    if Google didn't send a new one.
 * 4. Refresh fails, or there's no refresh token / no credentials to refresh
 *    with -> "disconnected", never a thrown error.
 */
export async function getValidDriveAccessToken(
  session: DriveSession,
  credentials: RefreshCredentials | null,
  exchangeRefreshToken: TokenExchange,
): Promise<DriveTokenOutcome> {
  if (isAccessTokenFresh(session)) {
    return { status: "valid", session, refreshed: false };
  }

  if (!session.refreshToken) {
    return { status: "disconnected", reason: "no-refresh-token" };
  }

  if (!credentials) {
    return { status: "disconnected", reason: "config-missing" };
  }

  try {
    const result = await exchangeRefreshToken({
      refreshToken: session.refreshToken,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });

    if (!result.ok || typeof result.accessToken !== "string" || result.accessToken.length === 0 || typeof result.expiresInSeconds !== "number" || result.expiresInSeconds <= 0) {
      return { status: "disconnected", reason: "refresh-failed" };
    }

    return {
      status: "valid",
      refreshed: true,
      session: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken && result.refreshToken.length > 0 ? result.refreshToken : session.refreshToken,
        expiresAt: Date.now() + result.expiresInSeconds * 1000,
      },
    };
  } catch {
    return { status: "disconnected", reason: "refresh-failed" };
  }
}
