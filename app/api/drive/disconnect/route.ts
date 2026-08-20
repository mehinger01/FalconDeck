import { NextResponse } from "next/server";
import { DRIVE_SESSION_COOKIE } from "@/lib/resources/googleDrive/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(DRIVE_SESSION_COOKIE);
  return response;
}
