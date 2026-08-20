import { NextRequest, NextResponse } from "next/server";
import { resolveDriveAccessToken } from "@/lib/resources/googleDrive/driveSessionServer";
import { DriveApiError, searchDriveFiles } from "@/lib/resources/googleDrive/driveApiClient";

/** Server-side proxy to Drive's files.list (search) - the access token never reaches the browser. */
export async function GET(request: NextRequest) {
  const access = await resolveDriveAccessToken(request);
  if (access.status === "unauthorized") {
    return NextResponse.json({ error: "Not connected to Google Drive." }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query) {
    const response = NextResponse.json({ files: [] });
    access.applyToResponse(response);
    return response;
  }

  try {
    const files = await searchDriveFiles(access.accessToken, query);
    const response = NextResponse.json({ files });
    access.applyToResponse(response);
    return response;
  } catch (error) {
    const status = error instanceof DriveApiError ? error.status : 502;
    const response = NextResponse.json({ error: "Google Drive search failed. Try again in a moment." }, { status });
    access.applyToResponse(response);
    return response;
  }
}
