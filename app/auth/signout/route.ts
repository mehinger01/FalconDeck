import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { type NextRequest, NextResponse } from "next/server";

/** Plain POST handler so a no-JS <form action="/auth/signout" method="post"> works from anywhere, e.g. NavBar. */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) {
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
}
