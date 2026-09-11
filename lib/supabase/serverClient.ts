import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client for Server Components and Route Handlers -
 * reads/writes the auth session via request cookies. Uses only the public
 * publishable key (Row Level Security still applies); never the service role key.
 *
 * Not wired into any route yet: no route is gated on auth in this
 * milestone, and there is no middleware.ts refreshing the session -
 * session-refresh middleware is deliberately deferred to the later
 * authentication/onboarding milestone, once the live app actually gates
 * routes on Supabase Auth. Verification scripts authenticate
 * programmatically via the Auth Admin API and don't need this file.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Setting cookies from a Server Component (rather than a Route
          // Handler or Server Action) throws - safe to ignore here since no
          // route depends on session refresh yet in this milestone.
        }
      },
    },
  });
}
