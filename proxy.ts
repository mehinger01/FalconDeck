import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; the
 * function itself is unchanged. This proxy only refreshes the Supabase
 * session cookie (optimistic, no DB query) - it never redirects. Route
 * gating (is there a session, is there a resolved organization) happens in
 * lib/auth/dal.ts, called from the (app) layout and /onboarding, which can
 * safely do the DB lookups Proxy is not meant for.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every route except static assets, so the session cookie stays
     * fresh everywhere (including /present and /demo, which remain
     * unauthenticated/public - this proxy never redirects them).
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
