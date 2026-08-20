import { NextRequest, NextResponse } from "next/server";
import { DRIVE_SESSION_COOKIE, isDriveSessionValid, parseDriveSession } from "@/lib/resources/googleDrive/session";
import { DriveApiError, listRecentDriveFiles } from "@/lib/resources/googleDrive/driveApiClient";

/** Server-side proxy to Drive's files.list (recent, sorted by modifiedTime). */
export async function GET(request: NextRequest) {
  const session = parseDriveSession(request.cookies.get(DRIVE_SESSION_COOKIE)?.value);
  if (!isDriveSessionValid(session)) {
    return NextResponse.json({ error: "Not connected to Google Drive." }, { status: 401 });
  }

  try {
    const files = await listRecentDriveFiles(session.accessToken);
    return NextResponse.json({ files });
  } catch (error) {
    const status = error instanceof DriveApiError ? error.status : 502;
    return NextResponse.json({ error: "Google Drive request failed. Try again in a moment." }, { status });
  }
}
