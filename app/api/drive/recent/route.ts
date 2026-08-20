import { NextRequest, NextResponse } from "next/server";
import { resolveDriveAccessToken } from "@/lib/resources/googleDrive/driveSessionServer";
import { DriveApiError, listRecentDriveFiles } from "@/lib/resources/googleDrive/driveApiClient";

/** Server-side proxy to Drive's files.list (recent, sorted by modifiedTime). */
export async function GET(request: NextRequest) {
  const access = await resolveDriveAccessToken(request);
  if (access.status === "unauthorized") {
    return NextResponse.json({ error: "Not connected to Google Drive." }, { status: 401 });
  }

  try {
    const files = await listRecentDriveFiles(access.accessToken);
    const response = NextResponse.json({ files });
    access.applyToResponse(response);
    return response;
  } catch (error) {
    const status = error instanceof DriveApiError ? error.status : 502;
    const response = NextResponse.json({ error: "Google Drive request failed. Try again in a moment." }, { status });
    access.applyToResponse(response);
    return response;
  }
}
