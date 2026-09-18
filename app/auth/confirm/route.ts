import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { destinationForResolution, resolveActiveOrganization } from "@/lib/auth/dal";

/**
 * Exchanges the token_hash from a Supabase confirmation/recovery email for
 * a session. Handles both signup confirmation (type=email) and password
 * recovery (type=recovery) - see lib/auth/actions.ts's signUp/requestPasswordReset,
 * which set the emailRedirectTo that points here.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const redirectTo = request.nextUrl.clone();
  redirectTo.searchParams.delete("token_hash");
  redirectTo.searchParams.delete("type");

  if (token_hash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      if (type === "recovery") {
        redirectTo.pathname = "/auth/reset-password";
      } else {
        const resolution = await resolveActiveOrganization();
        redirectTo.pathname = destinationForResolution(resolution);
      }
      return NextResponse.redirect(redirectTo);
    }
  }

  redirectTo.pathname = "/login";
  redirectTo.searchParams.set("error", "That link is invalid or has expired.");
  return NextResponse.redirect(redirectTo);
}
