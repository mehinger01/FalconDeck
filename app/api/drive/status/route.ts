import { NextRequest, NextResponse } from "next/server";
import { isGoogleDriveConfigured } from "@/lib/resources/googleDrive/config";
import { DRIVE_SESSION_COOKIE, parseDriveSession, sessionCanReconnect } from "@/lib/resources/googleDrive/session";

/**
 * Whether Drive is configured for this install, and whether this browser
 * has a session that's live or can be silently refreshed - never the
 * token itself, and never any other token metadata. Doesn't perform a
 * real refresh (that only happens on an actual Drive request, via
 * lib/resources/googleDrive/driveSessionServer.ts); `sessionCanReconnect`
 * only checks whether a refresh is *possible*.
 */
export async function GET(request: NextRequest) {
  const configured = isGoogleDriveConfigured();
  const session = parseDriveSession(request.cookies.get(DRIVE_SESSION_COOKIE)?.value);
  return NextResponse.json({ configured, connected: configured && sessionCanReconnect(session) });
}
