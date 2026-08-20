import { NextRequest, NextResponse } from "next/server";
import { getGoogleDriveConfig } from "@/lib/resources/googleDrive/config";
import { DRIVE_OAUTH_STATE_COOKIE, DRIVE_SESSION_COOKIE, serializeDriveSession } from "@/lib/resources/googleDrive/session";

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/**
 * Exchanges the OAuth `code` for tokens server-side (the client secret
 * never leaves the server) and stores the result only in an httpOnly,
 * secure, SameSite=Lax cookie - never in a response body, never in
 * localStorage.
 */
export async function GET(request: NextRequest) {
  const config = getGoogleDriveConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/resources?drive=not-configured", request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(DRIVE_OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/resources?drive=error", request.url));
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
      return NextResponse.redirect(new URL("/resources?drive=error", request.url));
    }

    const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;

    const response = NextResponse.redirect(new URL("/resources?drive=connected", request.url));
    response.cookies.set(
      DRIVE_SESSION_COOKIE,
      serializeDriveSession({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      },
    );
    response.cookies.delete(DRIVE_OAUTH_STATE_COOKIE);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/resources?drive=error", request.url));
  }
}
