import { NextRequest, NextResponse } from "next/server";
import { DRIVE_SESSION_COOKIE, isDriveSessionValid, parseDriveSession } from "@/lib/resources/googleDrive/session";
import { DriveApiError, getDriveFile } from "@/lib/resources/googleDrive/driveApiClient";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = parseDriveSession(request.cookies.get(DRIVE_SESSION_COOKIE)?.value);
  if (!isDriveSessionValid(session)) {
    return NextResponse.json({ error: "Not connected to Google Drive." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const file = await getDriveFile(session.accessToken, id);
    if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
    return NextResponse.json({ file });
  } catch (error) {
    const status = error instanceof DriveApiError ? error.status : 502;
    return NextResponse.json({ error: "Google Drive request failed. Try again in a moment." }, { status });
  }
}
