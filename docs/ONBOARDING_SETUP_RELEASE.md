# Streamlined onboarding foundation — release sequence

How to ship `feature/streamlined-onboarding-foundation`. Guided setup stays
inactive: nothing in `app/` or `components/` calls the setup entry logic. The only
behaviour that changes for teachers is how the ordinary save writes schedule
preferences (through `save_teacher_schedule_preferences`), so **the database goes
first**.

Background: `docs/ONBOARDING_SETUP_ARCHITECTURE.md` (§8.3 for the write protocol).

## 1. What is being released

| Migration | Contents | Touches existing objects? |
|---|---|---|
| `20261010210000_onboarding_setup_stage_a_schema.sql` | `setup_drafts`, `setup_completions` (RLS on, no client privileges) | No |
| `20261010210100_onboarding_setup_stage_b_rpcs.sql` | `get_setup_state`, `save_setup_draft`, `complete_setup` and five internal helpers | No |
| `20261010210200_teacher_schedule_preferences_write_rpc.sql` | `save_teacher_schedule_preferences`, `lock_own_membership` | No |

All three are additive: new tables, new functions, and privileges on those only. No
existing table, policy, trigger, function or grant is altered.

## 2. Sequence

### Prerequisite — reconcile the two transition-content migration versions (done)

Production records `transition_content_stage_b_lessons_warmup` and
`transition_content_stage_b_transition_overrides` as `20260928002032` and
`20260928002124`. The repository used to name those files `20260927150000` and
`20260927150100`. That mismatch would have made the dry run list five migrations, and
a real `db push` fail re-running the first transition file.

- **Repository.** PR #5 renamed the files to production's versions, contents
  unchanged, and was merged to `main` (`ecb7467`) and then into this branch.
  Production's history was not modified.
- **Staging.** `falcondeck-staging` was bootstrapped with the old versions, so its own
  history needs a matching relabel. It is staging-only and keeps the recorded SQL:

  ```sql
  -- Run in falcondeck-staging (fkqplulzwchunhthyoym) only - never production.
  begin;
  do $relabel$
  declare
    n integer;
  begin
    if (select count(*) from supabase_migrations.schema_migrations) <> 30 then
      raise exception 'expected 30 migration records before the relabel';
    end if;
    update supabase_migrations.schema_migrations
       set version = '20260928002032'
     where version = '20260927150000' and name = 'transition_content_stage_b_lessons_warmup';
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'lessons_warmup: expected 1 row, updated %', n; end if;
    update supabase_migrations.schema_migrations
       set version = '20260928002124'
     where version = '20260927150100' and name = 'transition_content_stage_b_transition_overrides';
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'transition_overrides: expected 1 row, updated %', n; end if;
    if (select count(*) from supabase_migrations.schema_migrations) <> 30 then
      raise exception 'expected 30 migration records after the relabel';
    end if;
    if exists (select 1 from supabase_migrations.schema_migrations
               where version in ('20260927150000', '20260927150100')) then
      raise exception 'an old version is still recorded';
    end if;
  end
  $relabel$;
  select version, name from supabase_migrations.schema_migrations
   where name like 'transition_content_stage_b%' order by version;
  commit;
  ```

  Any failed assertion raises inside the transaction and rolls everything back.

### Step 1 — Apply the migrations (production database)

1. `supabase db push --dry-run` against the linked project. It must list exactly
   the three files above, in that order, and nothing else.
2. `supabase db push`.

The application keeps running on the previous deployment throughout. That client
writes `teacher_schedule_preferences` directly and never calls the new functions, so
it is unaffected (see §3).

### Step 2 — Verify the ordinary-save RPC before deploying

Read-only catalog checks (SQL editor):

```sql
-- Recorded as applied
select version from supabase_migrations.schema_migrations
where version in ('20261010210000', '20261010210100', '20261010210200');      -- 3 rows

-- Present, with the intended security mode and privileges
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('save_teacher_schedule_preferences', 'lock_own_membership',
                    'get_setup_state', 'save_setup_draft', 'complete_setup')
order by 1;
-- expected: anon false and authenticated true on all five;
--           definer false only for save_teacher_schedule_preferences

select relname, relrowsecurity from pg_class
where relname in ('setup_drafts', 'setup_completions');                      -- both true
```

Then one call through the API, which is what the new client will do. Signed in as a
test teacher (e.g. `SUPABASE_TEST_USER_A`), call the RPC with an empty
`p_changed_columns`. It returns before taking any lock or writing anything:

```
POST {SUPABASE_URL}/rest/v1/rpc/save_teacher_schedule_preferences
apikey: <publishable key>
Authorization: Bearer <that teacher's access token>
{"p_organization_id":"<their organization id>","p_lunch_wave":"none",
 "p_active_bell_schedule_id":null,"p_changed_columns":[]}
```

- `204` — PostgREST sees the function and the caller may run it. Proceed.
- `404` / `PGRST202` — PostgREST's schema cache has not picked the function up.
  Run `notify pgrst, 'reload schema';` and repeat. **Do not deploy until it is 204.**
- The same request without `Authorization` must be refused (`401`).

### Step 3 — Deploy the application

Merge and let Vercel promote the production deployment as usual. Afterwards, as a
test teacher: change the lunch wave on the Schedule screen, reload, and confirm it
stuck. In the Supabase API logs that save is a `POST /rest/v1/rpc/save_teacher_schedule_preferences`
with a 2xx status, and there is no `PATCH` or `POST` to `/rest/v1/teacher_schedule_preferences`
from the new deployment.

### Never in the other order

The new client writes preferences only through the RPC. Deployed against a database
without it, every schedule or lunch-wave save would fail with `PGRST202`. (This
failure mode follows from the code; it was not reproduced.)

## 3. Compatibility with the deployed client

Production runs `7a638bc` (main). Its save path upserts
`teacher_schedule_preferences` whole, under the table's existing RLS.

Checked on the local integration stack (§5) with all three migrations applied, using
`7a638bc`'s own `SupabaseDataRepository`:

- first-row save, reload, and update save all work unchanged;
- interleaved with writes through the new RPC on the same row, each sees the other's
  committed value;
- no setup draft or completion is created; nothing calls the setup functions.

## 4. Rollback

**Application rollback** (Vercel instant rollback to the previous production
deployment) is the rollback. It is safe with the migrations left in place: the
previous client ignores the new tables and functions and writes preferences directly,
as verified above. Nothing has to be done to the database.

**Keep the database changes.** They are additive and inert without the new client.
Do not drop `save_teacher_schedule_preferences` while any deployment that calls it
is live. If the objects ever need to go, roll the application back first, then
remove them with a new forward migration — never by editing or reverting the applied
files.

**Data written meanwhile** needs no conversion. Preferences written through the RPC
are ordinary rows. Guided setup is inactive, so no draft or completion rows exist.

**Mixed bundles during rollout.** Tabs opened before the deploy keep writing
preferences directly until they reload. That is outside the write protocol, but it
only matters while a `complete_setup` runs, and nothing calls `complete_setup` until
guided setup is activated. Activation does not wait for old tabs to close, which
cannot be shown; it records how many accounts could be exposed instead
(architecture document §13, precondition 2).

## 5. What has and has not been validated

**Local integration stack** (throwaway, in WSL; no Docker was available):
PostgreSQL 17.10, Supabase Auth v2.197.0 and PostgREST v14.5 (the versions the
linked project reports), Supabase's role layout and default privileges, and a small
gateway standing in for Kong (routing and API-key check only). Every repository
migration was applied in order; Auth applied its own migrations.

- **HTTP, through Auth + PostgREST with supabase-js** (63 checks):
  - ordinary schedule and lunch-wave saves;
  - draft create, resume, revise, stale revision and completion;
  - completed-operation replay;
  - preferences changed before the first save and before completion;
  - anonymous and cross-owner rejection;
  - Supabase's default privileges did not re-grant anon execute;
  - lock order with one side held open on a direct connection and the other a live
    PostgREST request, in both directions and for the first row.
- **Direct database connection to the same stack:** the existing
  `verify:onboarding-setup-concurrency` (71) and `verify:onboarding-setup-db` (225),
  pointed at it with the opt-in `FALCON_TEST_DATABASE_URL`.
- **Browser** (`next dev` against the stack): chose a school schedule on
  `/setup/schedule`, then changed the lunch wave and active schedule on
  `/schedule`. Each change reached the database through the RPC and survived a
  reload. The page contacted only `localhost:3000` and the local gateway.

**Hosted staging** — `falcondeck-staging` (`fkqplulzwchunhthyoym`), a separate
Free-plan Supabase project that Vercel Preview now points at; never production.
- **Setup.**
  - All 30 repository migrations at `4e23df5` were applied in one transaction. Each
    file was fetched from GitHub at that commit and checked against the repository's
    MD5 before running, then recorded in `supabase_migrations.schema_migrations` as
    the CLI does.
  - Only synthetic `@example.test` accounts and data; no production data was copied.
  - **Cleanup verified:** 0 helper schemas, 0 `http` extensions, 30 migration
    records.
- **HTTPS, through hosted Kong, Auth and PostgREST** (44 checks, all pass): the same
  scenarios as the local HTTP check, using the production repositories and
  pre-seeded synthetic accounts.
  - ordinary schedule and lunch-wave saves, including after a reload;
  - the release smoke call;
  - draft create, resume, revise and conflicts;
  - completion and replay;
  - preferences changed before the first save and before completion;
  - anonymous and cross-owner rejection.
- **Not run on staging: the lock-order checks.** They need a direct database
  connection, and none is available to staging here.
- **Browser, signed in, on PR #4's preview build** (`dpl_D27HvJv6xNMmneu3jXprxHZp3dYK`,
  commit `4e23df5`):
  - chose a school schedule on `/setup/schedule`, then changed the lunch wave and
    active schedule on `/schedule`;
  - each change was a `save_teacher_schedule_preferences` call to staging, was in
    staging's database, and survived a reload;
  - the page contacted only the preview, Vercel's toolbar and staging's Supabase —
    never production.

**Not validated:**

- Supavisor (the pooler);
- lock order on hosted Supabase;
- the production application and production database;
- sign-up and password-reset email redirects on staging (they need a real inbox);
- real network latency under load.

Both browser runs used a background window. The user signed in to the preview
themselves; after that, clicks were dispatched through the DOM, not real pointer
input.

To rerun all of this: `docs/ONBOARDING_SETUP_INTEGRATION.md`. The checks are
`scripts/integration/onboarding-setup-http.ts` and
`scripts/integration/deployed-client-compat.ts`.
