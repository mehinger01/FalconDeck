/**
 * An isolated, throwaway PostgreSQL 17 server for database tests - a real
 * `postgres` process (the embedded-postgres package ships the binaries),
 * started on a free local port in a temporary directory and deleted on
 * close(). Real server, real connection pool: two requests can genuinely be
 * in flight at once, which is what scripts/verify-onboarding-setup-concurrency.ts
 * needs.
 *
 * Just enough of Supabase is shimmed for this repo's own migrations to
 * apply and behave as they do on a real project: the `anon` /
 * `authenticated` / `service_role` roles, an `auth` schema with
 * `auth.users` and `auth.uid()`, and PostgREST's per-request "switch to the
 * caller's role and set its JWT claims" step.
 *
 * Nothing here connects to the linked Supabase project. It reads no
 * environment file. Every migration under supabase/migrations is applied,
 * in filename order, to the empty server - which is what makes it safe to
 * exercise a migration that has not been applied anywhere.
 *
 * Fidelity limits (see docs/ONBOARDING_SETUP_ARCHITECTURE.md): same major
 * version as production, but no PostgREST, GoTrue, pooler, or Supabase
 * default privileges. `rpc()` reproduces only PostgREST's role/claims
 * handling and its `{ data, error }` result shape.
 */

import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, types, type PoolClient } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

// Match what PostgREST puts on the wire: `date` as "YYYY-MM-DD" text,
// `numeric` and `bigint` as JSON numbers. (timestamptz is handled per row
// in toWireRow.)
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(20, (value) => Number(value));

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

/**
 * `select("*")` with equality filters and ordering (all fetchAppData() asks
 * of a table), plus `upsert(rows)` and `delete()` with equality filters
 * and `update(patch)` with equality filters (all applyDiff() asks) - so the
 * real SupabaseDataRepository can run
 * against this database, as the calling user, under RLS.
 */
export interface SelectBuilder extends PromiseLike<RpcResult> {
  select(columns: string): SelectBuilder;
  eq(column: string, value: unknown): SelectBuilder;
  order(column: string, options?: { ascending?: boolean }): SelectBuilder;
  maybeSingle(): SelectBuilder;
  upsert(rows: Record<string, unknown> | Array<Record<string, unknown>>): SelectBuilder;
  /** With equality filters; resolves with the rows it changed, as `.update(...).select()` does. */
  update(patch: Record<string, unknown>): SelectBuilder;
  delete(): SelectBuilder;
}

/** The slice of supabase-js this repo's read path and RPC callers use - what `clientFor()` returns. */
export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  from(table: string): SelectBuilder;
}

export interface AsUserOptions {
  /** Defaults to Postgres's (and PostgREST's) default, READ COMMITTED. */
  isolation?: "read committed" | "repeatable read";
}

export interface TestDatabase {
  /** Runs as the database owner (bypasses RLS and grants) - for fixtures and assertions only. */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Runs one statement the way PostgREST would for this user: its own
   * connection and transaction, `authenticated` role, JWT `sub` claim set.
   * `userId: null` runs as `anon` with no claims.
   */
  asUser<T = Record<string, unknown>>(userId: string | null, sql: string, params?: unknown[], options?: AsUserOptions): Promise<T[]>;
  /** A client bound to one user. Every call takes its own pooled connection, so calls issued together really do overlap. */
  clientFor(userId: string | null): RpcClient;
  /** A dedicated owner connection, for a test that must hold a transaction open across other requests. Release it when done. */
  connect(): Promise<PoolClient>;
  createUser(email: string): Promise<string>;
  close(): Promise<void>;
}

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

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

/** timestamptz arrives from `pg` as a Date; PostgREST would have sent an ISO string. */
function toWireRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
  );
}

/** PostgREST sends a JSON argument as JSON; `pg` would otherwise turn a JS array into a Postgres array literal. */
function toParameter(value: unknown): unknown {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : value;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), "falcon-deck-pg-")),
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();

  const pool = new Pool({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres", max: 32 });
  // A connection the server closes during shutdown must not crash the process.
  pool.on("error", () => {});

  try {
    await pool.query(SUPABASE_SHIM_SQL);
    for (const file of listMigrationFiles()) {
      if (file === ACCOUNT_ORIGIN_MIGRATION) await pool.query(ACCOUNT_ORIGIN_PREFLIGHT_FIXTURE_SQL);
      try {
        await pool.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed to apply: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    await pool.end();
    await server.stop();
    throw error;
  }

  const primaryKeys = new Map<string, string[]>();
  async function primaryKeyColumns(table: string): Promise<string[]> {
    const cached = primaryKeys.get(table);
    if (cached) return cached;
    const result = await pool.query(
      `select a.attname as column
       from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = ('public.' || $1)::regclass and i.indisprimary
       order by array_position(i.indkey::int2[], a.attnum)`,
      [table],
    );
    const columns = result.rows.map((row) => identifier(row.column as string));
    primaryKeys.set(table, columns);
    return columns;
  }

  async function asUser<T>(userId: string | null, sql: string, params: unknown[] = [], options: AsUserOptions = {}): Promise<T[]> {
    const connection = await pool.connect();
    try {
      await connection.query(`begin isolation level ${options.isolation ?? "read committed"}`);
      await connection.query(`set local role ${userId === null ? "anon" : "authenticated"}`);
      await connection.query("select set_config('request.jwt.claims', $1, true)", [
        userId === null ? "" : JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      const result = await connection.query(sql, params);
      await connection.query("commit");
      return result.rows as T[];
    } catch (error) {
      await connection.query("rollback").catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  return {
    async admin<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    asUser,
    connect: () => pool.connect(),
    clientFor(userId) {
      return {
        async rpc(name, args) {
          const keys = Object.keys(args);
          const call = `select public.${identifier(name)}(${keys.map((key, index) => `${identifier(key)} => $${index + 1}`).join(", ")}) as result`;
          try {
            const rows = await asUser<{ result: unknown }>(userId, call, keys.map((key) => toParameter(args[key])));
            return { data: rows[0]?.result ?? null, error: null };
          } catch (error) {
            return { data: null, error: toRpcError(error) };
          }
        },
        from(table) {
          const filters: Array<[string, unknown]> = [];
          const orders: string[] = [];
          let single = false;
          let upsertRows: Array<Record<string, unknown>> | null = null;
          let deleting = false;
          let updatePatch: Record<string, unknown> | null = null;
          const run = async (): Promise<RpcResult> => {
            const where = filters.map(([column], index) => `${identifier(column)} = $${index + 1}`).join(" and ");
            try {
              if (upsertRows) {
                if (upsertRows.length === 0) return { data: null, error: null };
                // Same statement shape PostgREST's upsert produces: insert,
                // and on a primary-key conflict replace every sent column.
                const columns = Object.keys(upsertRows[0]).map(identifier);
                const key = await primaryKeyColumns(identifier(table));
                const assignments = columns.filter((column) => !key.includes(column)).map((column) => `${column} = excluded.${column}`);
                await asUser(
                  userId,
                  `insert into public.${table} (${columns.join(", ")})
                   select ${columns.join(", ")} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)
                   on conflict (${key.join(", ")}) do ${assignments.length > 0 ? `update set ${assignments.join(", ")}` : "nothing"}`,
                  [JSON.stringify(upsertRows)],
                );
                return { data: null, error: null };
              }
              if (updatePatch) {
                if (!where) throw new Error("refusing an unfiltered update");
                const columns = Object.keys(updatePatch).map(identifier);
                const offset = filters.length;
                const rows = await asUser<Record<string, unknown>>(
                  userId,
                  `update public.${identifier(table)} t
                   set ${columns.map((column) => `${column} = patch.${column}`).join(", ")}
                   from jsonb_populate_record(null::public.${table}, $${offset + 1}::jsonb) patch
                   where ${filters.map(([column], index) => `t.${identifier(column)} = $${index + 1}`).join(" and ")}
                   returning t.*`,
                  [...filters.map(([, value]) => value), JSON.stringify(updatePatch)],
                );
                return { data: rows.map(toWireRow), error: null };
              }
              if (deleting) {
                if (!where) throw new Error("refusing an unfiltered delete");
                await asUser(userId, `delete from public.${identifier(table)} where ${where}`, filters.map(([, value]) => value));
                return { data: null, error: null };
              }
            } catch (error) {
              return { data: null, error: toRpcError(error) };
            }
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
            upsert(rows) {
              upsertRows = Array.isArray(rows) ? rows : [rows];
              return builder;
            },
            delete() {
              deleting = true;
              return builder;
            },
            update(patch) {
              updatePatch = patch;
              return builder;
            },
            then: (onFulfilled, onRejected) => run().then(onFulfilled, onRejected),
          };
          return builder;
        },
      };
    },
    async createUser(email) {
      const result = await pool.query("insert into auth.users (email) values ($1) returning id", [email]);
      return result.rows[0].id as string;
    },
    async close() {
      await pool.end();
      await server.stop();
    },
  };
}
