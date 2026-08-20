import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { getGoogleDriveConfig } from "@/lib/resources/googleDrive/config";
import {
  DRIVE_SESSION_COOKIE,
  DRIVE_SESSION_COOKIE_MAX_AGE_SECONDS,
  parseDriveSession,
  serializeDriveSession,
} from "@/lib/resources/googleDrive/session";
import { getValidDriveAccessToken } from "@/lib/resources/googleDrive/tokenRefresh";
import { exchangeRefreshTokenWithGoogle } from "@/lib/resources/googleDrive/googleTokenExchange";

export type DriveAccessResult =
  | { status: "unauthorized" }
  | { status: "ok"; accessToken: string; applyToResponse: (response: NextResponse) => void };

/**
 * The single place `/api/drive/search`, `/api/drive/recent`, and
 * `/api/drive/file/[id]` get a usable access token from. Reads the
 * encrypted session cookie, refreshes it via `getValidDriveAccessToken`
 * when the access token is expired or close to it, and - only when a
 * refresh actually happened - re-encrypts and re-attaches the session
 * cookie via the returned `applyToResponse`. No route reimplements any of
 * this itself.
 */
export async function resolveDriveAccessToken(request: NextRequest): Promise<DriveAccessResult> {
  const session = parseDriveSession(request.cookies.get(DRIVE_SESSION_COOKIE)?.value);
  if (!session) return { status: "unauthorized" };

  const config = getGoogleDriveConfig();
  const outcome = await getValidDriveAccessToken(
    session,
    config ? { clientId: config.clientId, clientSecret: config.clientSecret } : null,
    exchangeRefreshTokenWithGoogle,
  );

  if (outcome.status === "disconnected") {
    return { status: "unauthorized" };
  }

  return {
    status: "ok",
    accessToken: outcome.session.accessToken,
    applyToResponse: (response) => {
      if (!outcome.refreshed) return;
      const serialized = serializeDriveSession(outcome.session);
      if (!serialized) return;
      response.cookies.set(DRIVE_SESSION_COOKIE, serialized, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: DRIVE_SESSION_COOKIE_MAX_AGE_SECONDS,
      });
    },
  };
}
