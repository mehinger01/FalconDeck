import { NextRequest, NextResponse } from "next/server";
import { getGoogleDriveConfig } from "@/lib/resources/googleDrive/config";
import {
  DRIVE_OAUTH_STATE_COOKIE,
  DRIVE_SESSION_COOKIE,
  DRIVE_SESSION_COOKIE_MAX_AGE_SECONDS,
  serializeDriveSession,
} from "@/lib/resources/googleDrive/session";

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Every exit path redirects through here so the short-lived state cookie never outlives the round-trip it guards, whether the callback succeeded or failed. */
function redirectAndClearState(request: NextRequest, outcome: "connected" | "error" | "not-configured"): NextResponse {
  const response = NextResponse.redirect(new URL(`/resources?drive=${outcome}`, request.url));
  response.cookies.delete(DRIVE_OAUTH_STATE_COOKIE);
  return response;
}

/**
 * Exchanges the OAuth `code` for tokens server-side (the client secret
 * never leaves the server) and stores the result only as an
 * AES-256-GCM encrypted, authenticated blob inside an httpOnly, secure
 * (in production), SameSite=Lax cookie - never in a response body, never
 * in localStorage, never readable by client JavaScript.
 */
export async function GET(request: NextRequest) {
  const config = getGoogleDriveConfig();
  if (!config) {
    return redirectAndClearState(request, "not-configured");
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(DRIVE_OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectAndClearState(request, "error");
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      return redirectAndClearState(request, "error");
    }

    const tokenData = (await tokenResponse.json().catch(() => null)) as GoogleTokenResponse | null;
    if (
      !tokenData ||
      typeof tokenData.access_token !== "string" ||
      tokenData.access_token.length === 0 ||
      typeof tokenData.expires_in !== "number" ||
      !Number.isFinite(tokenData.expires_in) ||
      tokenData.expires_in <= 0
    ) {
      return redirectAndClearState(request, "error");
    }

    const serialized = serializeDriveSession({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    });
    if (!serialized) {
      // FALCON_DECK_SESSION_SECRET disappeared between getGoogleDriveConfig()
      // and here - can't happen in a single request, but never fall back to
      // an unencrypted cookie if it somehow did.
      return redirectAndClearState(request, "not-configured");
    }

    const response = redirectAndClearState(request, "connected");
    response.cookies.set(DRIVE_SESSION_COOKIE, serialized, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DRIVE_SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    return redirectAndClearState(request, "error");
  }
}
