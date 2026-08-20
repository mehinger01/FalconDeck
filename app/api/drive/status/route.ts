import { NextRequest, NextResponse } from "next/server";
import { isGoogleDriveConfigured } from "@/lib/resources/googleDrive/config";
import { DRIVE_SESSION_COOKIE, isDriveSessionValid, parseDriveSession } from "@/lib/resources/googleDrive/session";

/** Whether Drive is configured for this install, and whether this browser has a live session - never the token itself. */
export async function GET(request: NextRequest) {
  const configured = isGoogleDriveConfigured();
  const session = parseDriveSession(request.cookies.get(DRIVE_SESSION_COOKIE)?.value);
  return NextResponse.json({ configured, connected: configured && isDriveSessionValid(session) });
}
