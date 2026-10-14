/**
 * Shared configuration for the integration checks in this folder. They run
 * against a throwaway local Supabase-like stack (Auth + PostgREST + Postgres),
 * never a hosted project: every URL must point at this machine.
 * docs/ONBOARDING_SETUP_INTEGRATION.md describes the stack and the variables.
 *
 * Deliberately imports nothing from the application (no "@/..." paths), so the
 * deployed-client check can run it from a checkout of an older commit.
 */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function requireLocal(name: string, value: string): string {
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    throw new Error(`${name} is not a URL.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`${name} must point at this machine (127.0.0.1 or localhost); got host "${host}". These checks never run against a hosted project.`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See docs/ONBOARDING_SETUP_INTEGRATION.md.`);
  return value;
}

export interface LocalStackConfig {
  /** Gateway URL - what the app uses as NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl: string;
  /** The stack's anon key (a JWT signed with the stack's own secret). */
  anonKey: string;
  /** A superuser connection to the stack's database, for fixtures and lock inspection. */
  databaseUrl: string;
  /** The gateway's request log, if available; checks that read it are skipped otherwise. */
  gatewayLog: string | null;
}

export function loadLocalStackConfig(): LocalStackConfig {
  return {
    supabaseUrl: requireLocal("FALCON_INTEGRATION_SUPABASE_URL", process.env.FALCON_INTEGRATION_SUPABASE_URL ?? "http://127.0.0.1:54321"),
    anonKey: required("FALCON_INTEGRATION_ANON_KEY"),
    databaseUrl: requireLocal("FALCON_INTEGRATION_DATABASE_URL", required("FALCON_INTEGRATION_DATABASE_URL")),
    gatewayLog: process.env.FALCON_INTEGRATION_GATEWAY_LOG || null,
  };
}

export function createChecker() {
  let failures = 0;
  return {
    check(label: string, condition: boolean, detail?: unknown) {
      if (condition) {
        console.log(`  ok  - ${label}`);
      } else {
        failures += 1;
        console.error(`FAIL  - ${label}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
      }
    },
    skip(label: string, reason: string) {
      console.log(`  skip - ${label} (${reason})`);
    },
    get failures() {
      return failures;
    },
  };
}
