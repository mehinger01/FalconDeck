import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Plain POST handler so a no-JS <form action="/auth/signout" method="post">
 * works from anywhere, e.g. NavBar.
 *
 * scope: "local" is deliberate, not Supabase's unscoped/global default -
 * Falcon Deck is explicitly designed for one teacher across multiple
 * devices (home + school). An unscoped signOut() revokes every session for
 * that user everywhere; scope: "local" revokes only this session/device's
 * refresh token, so signing out at home never signs the teacher out at
 * school (or vice versa). Tabs sharing this same browser/cookie session
 * still observe it together, which is correct - they share one session by
 * definition. No "sign out everywhere" option exists yet.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    await supabase.auth.signOut({ scope: "local" });
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
}
