import { NextRequest, NextResponse } from "next/server";
import { resolveDriveAccessToken } from "@/lib/resources/googleDrive/driveSessionServer";
import { DriveApiError, getDriveFile } from "@/lib/resources/googleDrive/driveApiClient";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await resolveDriveAccessToken(request);
  if (access.status === "unauthorized") {
    return NextResponse.json({ error: "Not connected to Google Drive." }, { status: 401 });
  }

  const { id } = await params;

  try {
    const file = await getDriveFile(access.accessToken, id);
    if (!file) {
      const response = NextResponse.json({ error: "File not found." }, { status: 404 });
      access.applyToResponse(response);
      return response;
    }
    const response = NextResponse.json({ file });
    access.applyToResponse(response);
    return response;
  } catch (error) {
    const status = error instanceof DriveApiError ? error.status : 502;
    const response = NextResponse.json({ error: "Google Drive request failed. Try again in a moment." }, { status });
    access.applyToResponse(response);
    return response;
  }
}
