# Onboarding setup — local integration checks

How to rerun the integration validation recorded in
`docs/ONBOARDING_SETUP_RELEASE.md` §5. It covers:

- the onboarding setup RPCs and the ordinary schedule-preference write, over HTTP
  through Supabase Auth and PostgREST;
- the database suites, against that same database;
- the currently deployed client, against this branch's migrations.

**This is a test procedure, not supported infrastructure.** The stack below is a
throwaway, hand-assembled stand-in for a Supabase project. It exists because this
machine has no Docker, so `supabase start` is unavailable. Nothing in the
application depends on it, and it is not part of `npm run verify`. With Docker, a
`supabase start` stack is the better target. The checks only need the URLs and keys
in §3.

Everything here runs on one machine. Every check refuses a URL whose host is not
`127.0.0.1` or `localhost`, so none can be pointed at a hosted project.

## 1. What the stack is, and what it is not

| Component | Here | On a Supabase project |
|---|---|---|
| Database | PostgreSQL 17.10 (`@embedded-postgres/linux-x64`), with Supabase's API roles, `authenticator`, `supabase_auth_admin` and default privileges recreated by `bootstrap.sql` | the `supabase/postgres` image (17.6 on the linked project) |
| Auth | Supabase Auth **v2.197.0** release binary, running its own migrations | same version |
| REST | PostgREST **v14.5** release binary | same version |
| Gateway | `gateway.mjs`: routes `/rest/v1` and `/auth/v1`, checks the API key, CORS | Kong |
| Pooler | none — PostgREST connects directly | Supavisor |

The Auth and PostgREST versions are the ones the linked project reports
(`supabase/.temp/gotrue-version`, `rest-version`).

**Not represented:**
- Kong's other plugins;
- Supavisor (the pooler);
- the `supabase/postgres` image's extensions and other init scripts;
- Storage, Realtime;
- network latency.

**Concurrency through the pooler is untested.**

## 2. Building the stack

Linux, or WSL2 on Windows. Needs `bash`, `curl`, `tar` with `xz`, Node 20 or later and
npm. No root.

Put the six files below in one directory (`$STACK_SRC`). The stack itself lives in
`$STACK_DIR` (default `~/falcon-integration-stack`), which holds:
- the downloaded binaries;
- the database files;
- the logs;
- `stack.env` — the stack's generated passwords and keys.

Never copy anything from `$STACK_DIR` into the repository.

```bash
export STACK_SRC=/path/to/those/files
export REPO_DIR=/path/to/FalconDeck      # on WSL, e.g. /mnt/c/.../FalconDeck
bash "$STACK_SRC/fetch.sh"               # once
bash "$STACK_SRC/up.sh"                  # fresh stack every time
```

`up.sh` always starts from an empty database. It applies Auth's migrations, then
every file in `$REPO_DIR/supabase/migrations` in filename order.

`20260922000000_organization_memberships_account_origin.sql` refuses to apply
unless two specific memberships exist. `setup.mjs` inserts the same two fixture rows
as `scripts/support/testDatabase.ts`, immediately before that migration.

#### `fetch.sh`

```bash
#!/usr/bin/env bash
# Downloads PostgREST v14.5, Supabase Auth v2.197.0 and a Linux PostgreSQL 17
# build into $STACK_DIR, and verifies the two release archives.
set -euo pipefail
STACK_DIR="${STACK_DIR:-$HOME/falcon-integration-stack}"
mkdir -p "$STACK_DIR/dl/postgrest" "$STACK_DIR/dl/auth" "$STACK_DIR/pg"
cd "$STACK_DIR/dl"
curl -sSL -o postgrest.tar.xz https://github.com/PostgREST/postgrest/releases/download/v14.5/postgrest-v14.5-linux-static-x86-64.tar.xz
curl -sSL -o auth.tar.gz https://github.com/supabase/auth/releases/download/v2.197.0/auth-v2.197.0-x86.tar.gz
sha256sum -c - <<'SUMS'
ab5cc7e974d4940447991804588cfb8b3f7b2c57b691f0905df04d51ede69470  postgrest.tar.xz
9daff5d1939c3142a1586e435e6e2a7a2f71534ec40ff1b196b59b83ad5678f3  auth.tar.gz
SUMS
tar -xJf postgrest.tar.xz -C postgrest
tar -xzf auth.tar.gz -C auth
cd "$STACK_DIR/pg"
[ -f package.json ] || npm init -y >/dev/null
npm i --no-audit --no-fund @embedded-postgres/linux-x64@17.10.0-beta.17 pg@8 >/dev/null
"$STACK_DIR/dl/postgrest/postgrest" --version
```

#### `bootstrap.sql`

```sql
-- Supabase's role layout on a vanilla PostgreSQL 17, run once as the
-- superuser before Auth's and the app's migrations: API roles, PostgREST's
-- login role, Auth's admin role and schema, and the default privileges
-- Supabase grants on objects the `postgres` role creates in `public`.
-- Login passwords are set afterwards by setup.mjs (generated per stack).
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

create role supabase_auth_admin login createrole noinherit;
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role;

alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
```

#### `setup.mjs`

```js
// Builds the stack's database: Supabase roles, Supabase Auth's own migrations
// (run by the Auth binary), then every app migration in filename order.
// Generates the stack's passwords and JWT secret, and writes them - with the
// anon and service keys derived from it - to $STACK_DIR/secrets.json and
// $STACK_DIR/stack.env (mode 0600). Usage: node setup.mjs <REPO_DIR>
import { createRequire } from "node:module";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STACK_DIR = process.env.STACK_DIR;
const REPO_DIR = process.argv[2];
const SUPERUSER_PASSWORD = process.env.STACK_SUPERUSER_PASSWORD;
if (!STACK_DIR || !REPO_DIR || !SUPERUSER_PASSWORD) throw new Error("STACK_DIR, REPO_DIR and STACK_SUPERUSER_PASSWORD are required");
const { Client } = createRequire(join(STACK_DIR, "pg/package.json"))("pg");
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(REPO_DIR, "supabase/migrations");

const b64url = (value) => Buffer.from(value).toString("base64url");
function sign(payload, secret) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

const secret = () => randomBytes(24).toString("hex");
const jwtSecret = secret();
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 30 * 24 * 3600;
const secrets = {
  jwtSecret,
  authenticatorPassword: secret(),
  authAdminPassword: secret(),
  anonKey: sign({ iss: "falcon-integration-stack", role: "anon", iat, exp }, jwtSecret),
  serviceKey: sign({ iss: "falcon-integration-stack", role: "service_role", iat, exp }, jwtSecret),
};
writeFileSync(join(STACK_DIR, "secrets.json"), JSON.stringify(secrets, null, 2), { mode: 0o600 });
const databaseUrl = `postgres://postgres:${SUPERUSER_PASSWORD}@127.0.0.1:54322/postgres`;
writeFileSync(
  join(STACK_DIR, "stack.env"),
  [
    "FALCON_INTEGRATION_SUPABASE_URL=http://127.0.0.1:54321",
    `FALCON_INTEGRATION_ANON_KEY=${secrets.anonKey}`,
    `FALCON_INTEGRATION_DATABASE_URL=${databaseUrl}`,
    `FALCON_INTEGRATION_GATEWAY_LOG=${join(STACK_DIR, "logs/gateway.log")}`,
    `FALCON_TEST_DATABASE_URL=${databaseUrl}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

const admin = new Client({ connectionString: databaseUrl });
await admin.connect();
await admin.query(readFileSync(join(HERE, "bootstrap.sql"), "utf8"));
await admin.query(`alter role authenticator password ${admin.escapeLiteral(secrets.authenticatorPassword)}`);
await admin.query(`alter role supabase_auth_admin password ${admin.escapeLiteral(secrets.authAdminPassword)}`);
console.log("bootstrap: roles and default privileges");

execFileSync(join(STACK_DIR, "dl/auth/auth"), ["migrate"], {
  env: {
    ...process.env,
    GOTRUE_DB_DRIVER: "postgres",
    DATABASE_URL: `postgres://supabase_auth_admin:${secrets.authAdminPassword}@127.0.0.1:54322/postgres`,
    GOTRUE_DB_MIGRATIONS_PATH: join(STACK_DIR, "dl/auth/migrations"),
    GOTRUE_JWT_SECRET: jwtSecret,
    GOTRUE_SITE_URL: "http://localhost:3000",
    API_EXTERNAL_URL: "http://127.0.0.1:54321/auth/v1",
    GOTRUE_LOG_LEVEL: "error",
  },
  stdio: ["ignore", "ignore", "inherit"],
});
console.log("auth: migrations applied by the Auth binary");

// Same fixture as scripts/support/testDatabase.ts: the account-origin
// migration refuses to apply without these two memberships.
const FIXTURE_BEFORE = "20260922000000_organization_memberships_account_origin.sql";
const FIXTURE_SQL = `
  insert into auth.users (id, email, aud, role) values
    ('00000000-0000-4000-8000-0000000000a1', 'legacy@example.test', 'authenticated', 'authenticated'),
    ('00000000-0000-4000-8000-0000000000a2', 'cloud@example.test', 'authenticated', 'authenticated');
  insert into public.organizations (id, name, slug) values
    ('00000000-0000-4000-8000-0000000000b1', 'Fixture Legacy School', 'fixture-legacy'),
    ('00000000-0000-4000-8000-0000000000b2', 'Fixture Cloud School', 'fixture-cloud');
  insert into public.organization_memberships (id, organization_id, user_id, role, status, local_data_migrated_at) values
    ('d930f71a-4a50-4416-8fd5-0e576fd0190e', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'admin', 'active', now()),
    ('c35d9d4c-c140-4adf-874f-da69030e26ce', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a2', 'admin', 'active', null);
`;
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  if (file === FIXTURE_BEFORE) await admin.query(FIXTURE_SQL);
  try {
    await admin.query(readFileSync(join(MIGRATIONS, file), "utf8"));
  } catch (error) {
    console.error(`FAILED ${file}: ${error.message}`);
    process.exit(1);
  }
  console.log(`app: ${file}`);
}
await admin.end();
```

#### `gateway.mjs`

```js
// Stand-in for Kong on :54321 - routing, API-key check and CORS only.
// /rest/v1 -> PostgREST :54330, /auth/v1 -> Auth :9999. Logs each request
// (method, path, origin) so a check can see where traffic went.
import { createServer, request } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STACK_DIR = process.env.STACK_DIR;
const { anonKey, serviceKey } = JSON.parse(readFileSync(join(STACK_DIR, "secrets.json"), "utf8"));
const LOG = join(STACK_DIR, "logs/gateway.log");
const ROUTES = [
  { prefix: "/rest/v1", port: 54330 },
  { prefix: "/auth/v1", port: 9999 },
];
const OPEN_AUTH = /^\/auth\/v1\/(verify|callback|authorize|health|\.well-known)/;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, content-profile, accept-profile, prefer, range, x-supabase-api-version",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};

createServer((req, res) => {
  const url = new URL(req.url, "http://gateway");
  appendFileSync(LOG, `${new Date().toISOString()} ${req.method} ${url.pathname} origin=${req.headers.origin ?? "-"}\n`);
  if (req.method === "OPTIONS") return void res.writeHead(200, CORS).end();
  const route = ROUTES.find((r) => url.pathname === r.prefix || url.pathname.startsWith(`${r.prefix}/`));
  if (!route) return void res.writeHead(404, { "content-type": "application/json", ...CORS }).end('{"message":"no route"}');
  const apikey = req.headers.apikey ?? url.searchParams.get("apikey");
  if (!OPEN_AUTH.test(url.pathname) && apikey !== anonKey && apikey !== serviceKey) {
    return void res.writeHead(401, { "content-type": "application/json", ...CORS }).end('{"message":"Invalid API key"}');
  }
  const headers = { ...req.headers, host: `127.0.0.1:${route.port}` };
  if (!headers.authorization && apikey) headers.authorization = `Bearer ${apikey}`;
  const upstream = request(
    { host: "127.0.0.1", port: route.port, method: req.method, path: (url.pathname.slice(route.prefix.length) || "/") + url.search, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, { ...up.headers, ...CORS });
      up.pipe(res);
    },
  );
  upstream.on("error", (error) => res.writeHead(502, { "content-type": "application/json", ...CORS }).end(JSON.stringify({ message: error.message })));
  req.pipe(upstream);
}).listen(54321, "0.0.0.0", () => console.log("gateway on :54321"));
```

#### `up.sh`

```bash
#!/usr/bin/env bash
# Starts a fresh stack: PostgreSQL :54322, Auth :9999, PostgREST :54330,
# gateway :54321. Requires REPO_DIR. Discards any previous stack's data.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
export STACK_DIR="${STACK_DIR:-$HOME/falcon-integration-stack}"
: "${REPO_DIR:?set REPO_DIR to the repository checkout}"
BIN="$STACK_DIR/pg/node_modules/@embedded-postgres/linux-x64/native/bin"
bash "$SRC/down.sh" || true
rm -rf "$STACK_DIR/data" "$STACK_DIR/logs" "$STACK_DIR/secrets.json" "$STACK_DIR/stack.env"
mkdir -p "$STACK_DIR/logs"
umask 077

export STACK_SUPERUSER_PASSWORD="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
printf '%s\n' "$STACK_SUPERUSER_PASSWORD" > "$STACK_DIR/pwfile"
"$BIN/initdb" -D "$STACK_DIR/data" -U postgres --pwfile="$STACK_DIR/pwfile" -A scram-sha-256 -E UTF8 --locale=C.UTF-8 >/dev/null
rm -f "$STACK_DIR/pwfile"
cat >> "$STACK_DIR/data/postgresql.conf" <<CONF
listen_addresses = '*'
port = 54322
unix_socket_directories = '$STACK_DIR'
CONF
# '*' so Windows reaches it through WSL's localhost forwarding; password auth only.
echo "host all all 0.0.0.0/0 scram-sha-256" >> "$STACK_DIR/data/pg_hba.conf"
"$BIN/pg_ctl" -D "$STACK_DIR/data" -l "$STACK_DIR/logs/postgres.log" -w start >/dev/null

node "$SRC/setup.mjs" "$REPO_DIR"
secret() { node -e 'console.log(require(process.argv[1])[process.argv[2]])' "$STACK_DIR/secrets.json" "$1"; }

# setsid + nohup: the services must outlive the shell (WSL ends a session's processes otherwise).
GOTRUE_DB_DRIVER=postgres \
DATABASE_URL="postgres://supabase_auth_admin:$(secret authAdminPassword)@127.0.0.1:54322/postgres" \
GOTRUE_DB_MIGRATIONS_PATH="$STACK_DIR/dl/auth/migrations" \
GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
API_EXTERNAL_URL="http://127.0.0.1:54321/auth/v1" \
GOTRUE_SITE_URL="http://localhost:3000" \
GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**,http://127.0.0.1:3000/**" \
GOTRUE_JWT_SECRET="$(secret jwtSecret)" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true \
GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_LOG_LEVEL=warn \
  setsid nohup "$STACK_DIR/dl/auth/auth" serve < /dev/null > "$STACK_DIR/logs/auth.log" 2>&1 &
echo $! > "$STACK_DIR/auth.pid"

cat > "$STACK_DIR/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:$(secret authenticatorPassword)@127.0.0.1:54322/postgres"
db-schemas = "public"
db-anon-role = "anon"
db-max-rows = 1000
jwt-secret = "$(secret jwtSecret)"
server-host = "127.0.0.1"
server-port = 54330
log-level = "warn"
CONF
setsid nohup "$STACK_DIR/dl/postgrest/postgrest" "$STACK_DIR/postgrest.conf" < /dev/null > "$STACK_DIR/logs/postgrest.log" 2>&1 &
echo $! > "$STACK_DIR/postgrest.pid"

setsid nohup node "$SRC/gateway.mjs" < /dev/null > "$STACK_DIR/logs/gateway.out" 2>&1 &
echo $! > "$STACK_DIR/gateway.pid"

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null http://127.0.0.1:9999/health && curl -sf -o /dev/null http://127.0.0.1:54330/ && curl -s -o /dev/null http://127.0.0.1:54321/; then
    echo "stack up - variables in $STACK_DIR/stack.env"; exit 0
  fi
  sleep 0.5
done
echo "stack did not come up"; tail -n 20 "$STACK_DIR"/logs/*.log; exit 1
```

#### `down.sh`

```bash
#!/usr/bin/env bash
# Stops the stack. Data stays in $STACK_DIR until up.sh or `rm -rf` removes it.
STACK_DIR="${STACK_DIR:-$HOME/falcon-integration-stack}"
BIN="$STACK_DIR/pg/node_modules/@embedded-postgres/linux-x64/native/bin"
for p in gateway postgrest auth; do
  [ -f "$STACK_DIR/$p.pid" ] && kill "$(cat "$STACK_DIR/$p.pid")" 2>/dev/null
  rm -f "$STACK_DIR/$p.pid"
done
[ -d "$STACK_DIR/data" ] && "$BIN/pg_ctl" -D "$STACK_DIR/data" -m fast -w stop >/dev/null 2>&1
echo "stack down"
```

## 3. Variables

`up.sh` writes all of these to `$STACK_DIR/stack.env`. That file is per-stack and
generated; never commit it or paste it anywhere.

| Variable | Used by | Meaning |
|---|---|---|
| `FALCON_INTEGRATION_SUPABASE_URL` | integration checks | Gateway URL. Defaults to `http://127.0.0.1:54321`. Must be local. |
| `FALCON_INTEGRATION_ANON_KEY` | integration checks | The stack's anon key. Required. |
| `FALCON_INTEGRATION_DATABASE_URL` | integration checks | Superuser connection to the stack's database, used for fixtures and lock inspection. Required; must be local. |
| `FALCON_INTEGRATION_GATEWAY_LOG` | HTTP check | The gateway's request log. Optional; without it, the two traffic checks are skipped. |
| `FALCON_TEST_DATABASE_URL` | `verify:onboarding-setup-*` | **Opt-in.** Runs the database suites against this already-migrated local database, not a new embedded server. Must be local. Unset (the default) leaves every verify script unchanged. |
| `FALCON_COMPAT_CHECKOUT` | deployed-client check | Directory of a checkout of the deployed commit. |

**Loading the variables:**
- **Linux:** `set -a; . "$STACK_DIR/stack.env"; set +a`.
- **Windows, with the stack in WSL:**

  ```powershell
  wsl -d Ubuntu -- cat ~/falcon-integration-stack/stack.env |
    ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
  $env:FALCON_INTEGRATION_GATEWAY_LOG = '\\wsl$\Ubuntu' + (wsl -d Ubuntu -- bash -lc 'echo $HOME/falcon-integration-stack/logs/gateway.log')
  ```

  WSL forwards the stack's ports to `127.0.0.1` on Windows. The log path has to be
  rewritten to its `\\wsl$` form.

## 4. Running the checks

From the repository root, with the variables loaded:

```bash
npm run integration:onboarding-setup-http                # HTTP: Auth + PostgREST (63 checks)
FALCON_TEST_DATABASE_URL=$FALCON_INTEGRATION_DATABASE_URL npm run verify:onboarding-setup-concurrency
FALCON_TEST_DATABASE_URL=$FALCON_INTEGRATION_DATABASE_URL npm run verify:onboarding-setup-db
```

**What the two suites do differently here.** With `FALCON_TEST_DATABASE_URL`, they use
the stack's database over direct connections:
- they apply no migrations;
- each run signs up fresh users;
- the database is not reset;
- the suites still exercise SQL directly, not HTTP.

**Deployed client** — from a checkout of the deployed commit (production runs
`7a638bc`):

```bash
git worktree add --detach ../falcon-deployed 7a638bc
ln -s "$PWD/node_modules" ../falcon-deployed/node_modules   # Windows: mklink /J
cd ../falcon-deployed
FALCON_COMPAT_CHECKOUT="$PWD" npx tsx "$OLDPWD/scripts/integration/deployed-client-compat.ts"
```

It loads that checkout's own `SupabaseDataRepository`, so it must be started from
the checkout's directory, where its `@/...` imports resolve. It shares
`node_modules` with this branch; `@supabase/supabase-js` and `pg` are the same
versions on both commits today.

**Fixtures.**
- Each check creates its own data: new users through Auth sign-up, their schools
  through `bootstrap_organization`, and school schedules through the superuser
  connection.
- Nothing is cleaned up per run; the whole stack is disposable.
- Runs do not interfere: every email is unique.

**Browser check** (manual). Run `next dev` with the stack in place of the hosted
project. Process environment variables take precedence over `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$FALCON_INTEGRATION_ANON_KEY npx next dev -p 3000
```

1. Sign up on `/login`; signup is auto-confirmed.
2. Add a school schedule over the superuser connection, or build your own.
3. Change preferences on `/setup/schedule` and `/schedule`, then reload.
4. In the browser's network panel, confirm every Supabase request went to
   `127.0.0.1:54321`, and that preference saves are
   `POST /rest/v1/rpc/save_teacher_schedule_preferences`.

## 5. Cleanup

```bash
bash "$STACK_SRC/down.sh"
rm -rf "${STACK_DIR:-$HOME/falcon-integration-stack}"   # binaries, data, logs, generated keys
git worktree remove ../falcon-deployed                  # after deleting its node_modules link
```

The stack writes nothing into the repository.
- `next dev` may re-add its block to `AGENTS.md`; discard that.
- `.next/` is ignored.

## 6. Hosted pooler checks (staging only)

`npm run verify:onboarding-setup-pooler` runs completion against ordinary
preference saves, in both orders and for the first preferences row, through
Supabase's **transaction pooler** on `falcondeck-staging`
(`fkqplulzwchunhthyoym`). It is the hosted counterpart of
`verify:onboarding-setup-concurrency` §10. It is not PostgREST: the deployed app
reaches the database through PostgREST, which does not go through the pooler; the
HTTPS checks (release document §5) cover that path.

**Target.** `scripts/support/stagingPooler.ts` refuses, before connecting, any URL
that is not `postgres.fkqplulzwchunhthyoym@aws-N-<region>.pooler.supabase.com:6543/postgres`
(production's ref is refused by name). After connecting, and before any write, it
refuses a database with any Auth user outside `@example.test`, or without the
onboarding migrations recorded. It never applies a migration.

**Fixtures and cleanup.** Every case makes a new `pooler-<run>-<case>+<tag>@example.test`
user and school through `bootstrap_organization()`. Everything else (every
school-scoped table, `organizations`, `auth.users`) is fingerprinted before and
after and must be unchanged. Cleanup removes only the run's users, memberships and
schools, in one transaction, and refuses if any of them is not a fixture.

**Transactions.** Every unit is one explicit `begin` … `commit` (or one statement)
using `set local` only; nothing relies on session state.

### Getting the connection string

1. In the Supabase dashboard, open **falcondeck-staging**. Check that the address
   bar shows `fkqplulzwchunhthyoym` - not `rlfydgbololkbrcloneb` (production).
2. Press **Connect** (top bar) → **Connection String** → Type **URI**, Source
   **Primary database**, Method **Transaction pooler**. Copy the URI. It contains
   `[YOUR-PASSWORD]`, not the password.
3. The password is the `postgres` password chosen when the project was created; the
   dashboard cannot show it. If nobody has it, it has to be reset (Project Settings →
   Database → Reset database password). That changes only staging's `postgres` login
   password: Vercel Preview (publishable API key), the Supabase connector (management
   API) and Supabase's own service roles do not use it. Production is a different
   project and is not affected.

### Storing it without displaying it

In your own PowerShell window (it prompts, so not through an agent):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\set-staging-pooler-url.ps1
```

`scripts/set-staging-pooler-url.ps1` holds staging's pooler host, port, database
and user (`aws-0-us-east-2.pooler.supabase.com:6543`, `postgres`,
`postgres.fkqplulzwchunhthyoym`) and contains no secret. It refuses to write unless
git reports `.env.staging-pooler.local` ignored and untracked, prompts for the
password with masked input, URL-encodes it, writes the one line, re-checks git
afterwards (deleting the file if it is not ignored), and prints only user, host,
port and database. `-ExecutionPolicy Bypass` applies to that one process. It runs
in Windows PowerShell 5.1 (no `--error-unmatch`, whose stderr becomes a
terminating error there).

Keep it in that file, not in a persistent environment variable: the local database
suites read `FALCON_TEST_DATABASE_URL` too, and refuse any host but this machine.

### Running

```bash
npm run verify:onboarding-setup-pooler                       # target check only; writes nothing
npm run verify:onboarding-setup-pooler -- --run              # the scenarios
npm run verify:onboarding-setup-pooler -- --cleanup-leftovers # fixtures left by a crashed run
```

Only host, port and user are ever printed. Delete `.env.staging-pooler.local` when
done. Staging is a Free-plan project and pauses after about a week idle; restore it
from the dashboard first if the connection times out.

**Last run:** 2026-10-27, `pooler-20261027-edb109`: 29 of 29 checks passed; 11
fixture users and schools removed; every unrelated row unchanged. Results are in
architecture document §8.3 and release document §5.
