import { NextRequest, NextResponse } from "next/server";
import { DRIVE_SESSION_COOKIE, isDriveSessionValid, parseDriveSession } from "@/lib/resources/googleDrive/session";
import { DriveApiError, searchDriveFiles } from "@/lib/resources/googleDrive/driveApiClient";

/** Server-side proxy to Drive's files.list (search) - the access token never reaches the browser. */
export async function GET(request: NextRequest) {
  const session = parseDriveSession(request.cookies.get(DRIVE_SESSION_COOKIE)?.value);
  if (!isDriveSessionValid(session)) {
    return NextResponse.json({ error: "Not connected to Google Drive." }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ files: [] });

  try {
    const files = await searchDriveFiles(session.accessToken, query);
    return NextResponse.json({ files });
  } catch (error) {
    const status = error instanceof DriveApiError ? error.status : 502;
    return NextResponse.json({ error: "Google Drive search failed. Try again in a moment." }, { status });
  }
}
