import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request. This is
 * optimistic-only (no database query) per Next's own Proxy guidance -
 * Proxy runs on every route including prefetches, so it must stay cheap.
 * Route-level authorization (is there a session at all, does it have a
 * resolved organization) lives in lib/auth/dal.ts, called from layouts/
 * pages/actions - never here.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return supabaseResponse;

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
      },
    },
  });

  // Do not run code between createServerClient and getClaims() - see
  // current Supabase SSR guidance: a mistake here can cause users to be
  // randomly logged out. getClaims() is what actually refreshes the token
  // when needed; nothing else in this function should intervene.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
