/**
 * An isolated, in-process Postgres (PGlite - real Postgres compiled to
 * WASM, no Docker, no network) with just enough of Supabase's surface
 * shimmed for this repo's own migrations to apply and behave the way they
 * do on a real project: the `anon`/`authenticated`/`service_role` roles, an
 * `auth` schema with `auth.users` and `auth.uid()`, and PostgREST's
 * per-request "switch to the caller's role + set its JWT claims" step.
 *
 * Nothing here ever connects to the linked Supabase project - a database is
 * created in memory, the migration files under supabase/migrations are
 * applied to it in filename order, and it is discarded when the process
 * exits. That is what makes it safe to exercise an UNAPPLIED migration.
 *
 * Known fidelity limits (see docs/ONBOARDING_SETUP_ARCHITECTURE.md):
 * - One connection, so two transactions can never genuinely overlap. Lock
 *   ordering under real concurrency is reasoned about, not exercised, here.
 * - No PostgREST/GoTrue/Storage - `rpc()` below reproduces only PostgREST's
 *   role/claims handling and its `{ data, error }` result shape.
 */

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const DATE_TYPE_OID = 1082;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function toRpcError(error: unknown): RpcError {
  const code = (error as { code?: unknown }).code;
  return {
    message: error instanceof Error ? error.message : String(error),
    code: typeof code === "string" ? code : undefined,
  };
}

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Not a plain identifier: ${name}`);
  return name;
}

/** timestamptz arrives from PGlite as a Date; PostgREST would have sent an ISO string. */
function toWireRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

const SUPABASE_SHIM_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  -- Same resolution order as Supabase's own auth.uid().
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

/**
 * 20260922000000_organization_memberships_account_origin.sql refuses to
 * apply unless organization_memberships holds exactly the two production
 * rows it was written against. These two rows (and the users/organizations
 * they need) exist only so that migration's own preflight passes here; the
 * ids are the ones that file names.
 */
const ACCOUNT_ORIGIN_MIGRATION = "20260922000000_organization_memberships_account_origin.sql";
export const FIXTURE_LEGACY_MEMBERSHIP_ID = "d930f71a-4a50-4416-8fd5-0e576fd0190e";
export const FIXTURE_CLOUD_MEMBERSHIP_ID = "c35d9d4c-c140-4adf-874f-da69030e26ce";
export const FIXTURE_LEGACY_USER_ID = "00000000-0000-4000-8000-0000000000a1";
export const FIXTURE_CLOUD_USER_ID = "00000000-0000-4000-8000-0000000000a2";
export const FIXTURE_LEGACY_ORGANIZATION_ID = "00000000-0000-4000-8000-0000000000b1";
export const FIXTURE_CLOUD_ORGANIZATION_ID = "00000000-0000-4000-8000-0000000000b2";

const ACCOUNT_ORIGIN_PREFLIGHT_FIXTURE_SQL = `
  insert into auth.users (id, email) values
    ('${FIXTURE_LEGACY_USER_ID}', 'legacy@example.test'),
    ('${FIXTURE_CLOUD_USER_ID}', 'cloud@example.test');
  insert into public.organizations (id, name, slug) values
    ('${FIXTURE_LEGACY_ORGANIZATION_ID}', 'Fixture Legacy School', 'fixture-legacy'),
    ('${FIXTURE_CLOUD_ORGANIZATION_ID}', 'Fixture Cloud School', 'fixture-cloud');
  insert into public.organization_memberships (id, organization_id, user_id, role, status, local_data_migrated_at) values
    ('${FIXTURE_LEGACY_MEMBERSHIP_ID}', '${FIXTURE_LEGACY_ORGANIZATION_ID}', '${FIXTURE_LEGACY_USER_ID}', 'admin', 'active', now()),
    ('${FIXTURE_CLOUD_MEMBERSHIP_ID}', '${FIXTURE_CLOUD_ORGANIZATION_ID}', '${FIXTURE_CLOUD_USER_ID}', 'admin', 'active', null);
`;

export interface RpcError {
  message: string;
  code?: string;
}

export interface RpcResult {
  data: unknown;
  error: RpcError | null;
}

/** `select("*")` with equality filters and ordering - the whole of what fetchAppData() asks of a table. */
export interface SelectBuilder extends PromiseLike<RpcResult> {
  select(columns: "*"): SelectBuilder;
  eq(column: string, value: unknown): SelectBuilder;
  order(column: string, options?: { ascending?: boolean }): SelectBuilder;
  maybeSingle(): SelectBuilder;
}

/** The slice of supabase-js this repo's read path and RPC callers use - what `clientFor()` returns. */
export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  from(table: string): SelectBuilder;
}

export interface TestDatabase {
  /** Runs as the database owner (bypasses RLS and grants) - for fixtures and assertions only. */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Runs one statement the way PostgREST would for this user: its own
   * transaction, `authenticated` role, JWT `sub` claim set. `userId: null`
   * runs as `anon` with no claims.
   */
  asUser<T = Record<string, unknown>>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** An `rpc()`-only client bound to one user, each call its own transaction. */
  clientFor(userId: string | null): RpcClient;
  createUser(email: string): Promise<string>;
  close(): Promise<void>;
}

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  // `date` stays the "YYYY-MM-DD" text PostgREST would send (PGlite's
  // default turns it into a JS Date).
  const db = new PGlite({ parsers: { [DATE_TYPE_OID]: (value: string) => value } });
  await db.exec(SUPABASE_SHIM_SQL);

  for (const file of listMigrationFiles()) {
    if (file === ACCOUNT_ORIGIN_MIGRATION) await db.exec(ACCOUNT_ORIGIN_PREFLIGHT_FIXTURE_SQL);
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed to apply: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function asUser<T>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return db.transaction(async (tx) => {
      await tx.exec(`set local role ${userId === null ? "anon" : "authenticated"}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        userId === null ? "" : JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      const result = await tx.query<T>(sql, params);
      return result.rows;
    });
  }

  return {
    async admin<T>(sql: string, params: unknown[] = []) {
      return (await db.query<T>(sql, params)).rows;
    },
    asUser,
    clientFor(userId) {
      return {
        async rpc(name, args) {
          const keys = Object.keys(args);
          const call = `select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(", ")}) as result`;
          try {
            const rows = await asUser<{ result: unknown }>(userId, call, keys.map((key) => args[key]));
            return { data: rows[0]?.result ?? null, error: null };
          } catch (error) {
            return { data: null, error: toRpcError(error) };
          }
        },
        from(table) {
          const filters: Array<[string, unknown]> = [];
          const orders: string[] = [];
          let single = false;
          const run = async (): Promise<RpcResult> => {
            const where = filters.map(([column], index) => `${identifier(column)} = $${index + 1}`).join(" and ");
            const sql =
              `select * from public.${identifier(table)}` +
              (where ? ` where ${where}` : "") +
              (orders.length > 0 ? ` order by ${orders.join(", ")}` : "");
            try {
              const rows = (await asUser<Record<string, unknown>>(userId, sql, filters.map(([, value]) => value))).map(
                toWireRow,
              );
              return { data: single ? (rows[0] ?? null) : rows, error: null };
            } catch (error) {
              return { data: null, error: toRpcError(error) };
            }
          };
          const builder: SelectBuilder = {
            select: () => builder,
            eq(column, value) {
              filters.push([column, value]);
              return builder;
            },
            order(column, options) {
              orders.push(`${identifier(column)} ${options?.ascending === false ? "desc" : "asc"}`);
              return builder;
            },
            maybeSingle() {
              single = true;
              return builder;
            },
            then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
          };
          return builder;
        },
      };
    },
    async createUser(email) {
      const rows = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
      return rows.rows[0].id;
    },
    close: () => db.close(),
  };
}
