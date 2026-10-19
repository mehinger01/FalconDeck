/**
 * The one way the hosted-pooler checks reach a database: Supabase's
 * transaction pooler (Supavisor, port 6543) for the staging project
 * `falcondeck-staging` (fkqplulzwchunhthyoym), and nothing else.
 *
 * The connection string is read from FALCON_TEST_DATABASE_URL - in the
 * process environment, or else in the git-ignored `.env.staging-pooler.local`
 * at the repository root. It is never printed, logged or echoed in an error;
 * only the host, port and user are ever shown.
 *
 * Two independent checks before anything is written:
 *   1. The URL itself: the pooler host, port 6543, user
 *      `postgres.fkqplulzwchunhthyoym`. Production's project ref is refused
 *      by name, and so is any other host, port, user or database.
 *   2. The database it reaches: no Auth user outside `@example.test` (staging
 *      holds only synthetic accounts; production holds real teachers), and
 *      the onboarding migrations and functions present - this never applies
 *      a migration, it refuses instead.
 *
 * Why not FALCON_TEST_DATABASE_URL through createTestDatabase(): that opt-in
 * deliberately refuses any host but this machine, and keeps doing so.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { attach, type TestDatabase } from "./testDatabase";

export const STAGING_PROJECT_REF = "fkqplulzwchunhthyoym";
const PRODUCTION_PROJECT_REF = "rlfydgbololkbrcloneb";
const VARIABLE = "FALCON_TEST_DATABASE_URL";
const LOCAL_FILE = ".env.staging-pooler.local";
/** Supavisor's shared pooler hosts, e.g. aws-0-us-east-2.pooler.supabase.com. */
const POOLER_HOST = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;
const TRANSACTION_POOLER_PORT = "6543";
const EXPECTED_USER = `postgres.${STAGING_PROJECT_REF}`;

/** Migrations the checks depend on; refused, not applied, if any is missing. */
const REQUIRED_MIGRATIONS = ["20260922010000", "20261010210000", "20261010210100", "20261010210200"];
const REQUIRED_FUNCTIONS = ["bootstrap_organization", "save_setup_draft", "complete_setup", "save_teacher_schedule_preferences"];

export interface StagingTarget {
  /** host:port as user - safe to print. */
  label: string;
  connectionString: string;
}

function readConnectionString(): string {
  const fromEnvironment = process.env[VARIABLE];
  if (fromEnvironment) return fromEnvironment.trim();
  const file = join(process.cwd(), LOCAL_FILE);
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*FALCON_TEST_DATABASE_URL\s*=\s*(.*?)\s*$/.exec(line);
      if (match) return match[1].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  throw new Error(`${VARIABLE} is not set (environment or ${LOCAL_FILE}). See docs/ONBOARDING_SETUP_INTEGRATION.md, "Hosted pooler checks".`);
}

/** Parses and checks the URL. Every refusal names the offending part - never the password. */
export function stagingTarget(): StagingTarget {
  const connectionString = readConnectionString();
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${VARIABLE} is not a connection URL.`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") throw new Error(`${VARIABLE}: expected a postgresql:// URL, got "${url.protocol}".`);
  const user = decodeURIComponent(url.username);
  if (connectionString.includes(PRODUCTION_PROJECT_REF)) throw new Error(`${VARIABLE} names the production project (${PRODUCTION_PROJECT_REF}). Refused.`);
  if (!POOLER_HOST.test(url.hostname)) throw new Error(`${VARIABLE}: host "${url.hostname}" is not Supabase's pooler (aws-N-<region>.pooler.supabase.com). Direct and other hosts are refused.`);
  if (url.port !== TRANSACTION_POOLER_PORT) throw new Error(`${VARIABLE}: port "${url.port || "(default)"}" is not the transaction pooler's ${TRANSACTION_POOLER_PORT}.`);
  if (user !== EXPECTED_USER) throw new Error(`${VARIABLE}: user "${user}" is not ${EXPECTED_USER}; only falcondeck-staging is accepted.`);
  if (url.pathname !== "/postgres") throw new Error(`${VARIABLE}: database "${url.pathname.slice(1)}" is not "postgres".`);
  if (!url.password) throw new Error(`${VARIABLE} has no password.`);
  return { label: `${user}@${url.hostname}:${url.port}`, connectionString };
}

export interface StagingFacts {
  serverVersion: string;
  authUsers: number;
  /** Distinct server backends seen across consecutive one-statement transactions on one client connection. */
  backendsAcrossTransactions: number;
}

/**
 * Connects and proves the target is staging (see the file comment), read-only.
 * Returns the TestDatabase API over a pool that only ever runs explicit
 * transactions or single statements - what a transaction pooler supports.
 */
export async function connectToStaging(target: StagingTarget): Promise<{ db: TestDatabase; facts: StagingFacts }> {
  const pool = new Pool({ connectionString: target.connectionString, max: 24, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  // A pool error would otherwise surface with the connection details attached.
  pool.on("error", () => {});
  const db = attach(pool, () => pool.end(), true);
  try {
    const [version] = await db.admin<{ v: string }>("select current_setting('server_version') as v");
    const [users] = await db.admin<{ total: number; outside: number }>(
      "select count(*)::int as total, count(*) filter (where email is null or email not like '%@example.test')::int as outside from auth.users",
    );
    if (users.outside !== 0) {
      throw new Error(`Refused: this database has ${users.outside} Auth user(s) outside @example.test. falcondeck-staging holds only synthetic accounts; this is not it.`);
    }
    const migrations = await db.admin<{ version: string }>("select version from supabase_migrations.schema_migrations where version = any($1)", [REQUIRED_MIGRATIONS]);
    const missingMigrations = REQUIRED_MIGRATIONS.filter((v) => !migrations.some((m) => m.version === v));
    if (missingMigrations.length) throw new Error(`Refused: migrations not recorded on this database: ${missingMigrations.join(", ")}. This runner never applies migrations.`);
    const functions = await db.admin<{ proname: string }>("select distinct proname from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)", [REQUIRED_FUNCTIONS]);
    const missingFunctions = REQUIRED_FUNCTIONS.filter((f) => !functions.some((row) => row.proname === f));
    if (missingFunctions.length) throw new Error(`Refused: functions missing: ${missingFunctions.join(", ")}.`);

    // Informational: in transaction mode, consecutive transactions on one client connection may land on different backends.
    const client = await pool.connect();
    const pids = new Set<number>();
    try {
      for (let i = 0; i < 12; i += 1) pids.add((await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid);
    } finally {
      client.release();
    }
    return { db, facts: { serverVersion: version.v, authUsers: users.total, backendsAcrossTransactions: pids.size } };
  } catch (error) {
    await pool.end().catch(() => {});
    throw error;
  }
}
