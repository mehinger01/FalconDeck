import { createBrowserClient } from "@supabase/ssr";

/**
 * Client-side Supabase client - safe for the browser, uses only the public
 * publishable key (subject to Row Level Security; grants no access on its own).
 * Not wired into any route or component yet: this milestone builds and
 * integration-tests the Supabase foundation (schema, RLS, seed data,
 * SupabaseDataRepository) in isolation. Production repository selection is
 * unchanged - see docs/V2_ARCHITECTURE.md / docs/V2_DATABASE_SCHEMA.md.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)."
    );
  }
  return createBrowserClient(url, publishableKey);
}
