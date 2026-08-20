import { NextResponse } from "next/server";
import { getGoogleDriveConfig } from "@/lib/resources/googleDrive/config";
import { DRIVE_OAUTH_STATE_COOKIE } from "@/lib/resources/googleDrive/session";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/**
 * Starts the OAuth flow by redirecting to Google's consent screen. Never
 * reachable with a "successful" outcome unless GOOGLE_DRIVE_CLIENT_ID/
 * _CLIENT_SECRET/_REDIRECT_URI are actually set (see .env.example) - this
 * route does not fake a connection when they're absent.
 */
export async function GET() {
  const config = getGoogleDriveConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Google Drive integration has not been configured for this installation." },
      { status: 501 },
    );
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  response.cookies.set(DRIVE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
