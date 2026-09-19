import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers - reads/writes the auth session via request cookies. Uses
 * only the public publishable key (Row Level Security still applies);
 * never the service role key.
 *
 * Used by lib/auth/dal.ts and lib/auth/actions.ts (Authentication &
 * Organization Onboarding milestone) and by the Route Handlers under
 * app/auth/*. Session refresh across requests is handled by proxy.ts /
 * lib/supabase/proxy.ts, not by this file.
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
