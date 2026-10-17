# Falcon Deck — Current State

Handoff snapshot for a fresh session. Read this before starting any new work.
Reconciled against the code and the live migration list on 2026-10-10; the previous
version of this file described the app before the cloud cutover and was wrong on
most points below.

## Repo / deployment identity

- **GitHub repo:** `mehinger01/FalconDeck`
- **`main` at reconciliation:** `7a638bc` (PR #3, Present/Preview crash reporting)
- **Production since 2026-10-16:** `e265b80` (PR #4, streamlined-onboarding
  persistence foundation, no UI). Vercel deployment `dpl_Bh77UMLju6iggEyJsSamgMyXvUpv`
  serves `teachdeckapp.com` (redirects to www), `www.teachdeckapp.com` and
  `falcon-deck.vercel.app`. Release record: `docs/ONBOARDING_SETUP_RELEASE.md` §6.
- **Supabase project ref:** `rlfydgbololkbrcloneb` — production.
- **Staging:** `falcondeck-staging` (`fkqplulzwchunhthyoym`), a Free-plan project in a
  separate organization, holding synthetic data only. Vercel Preview points at it.

## Supabase status

- **All 30 repository migrations are applied to production**, matching by name and
  version. The latest three were applied on 2026-10-16, before PR #4 was merged:
  - `20261010210000_onboarding_setup_stage_a_schema.sql`
  - `20261010210100_onboarding_setup_stage_b_rpcs.sql`
  - `20261010210200_teacher_schedule_preferences_write_rpc.sql`

  The two transition-content Stage B files used to differ by version only; PR #5
  (`ecb7467`) renamed them to production's recorded versions. See "Migration version
  reconciliation" below.
- **Ordinary schedule-preference saves now depend on
  `save_teacher_schedule_preferences`.** Never remove it while a deployment that
  calls it is live.
- **Guided setup is inactive.** The setup tables and RPCs exist, but nothing in
  `app/` or `components/` calls them. Both setup tables are empty.
- Tables: the 19-table V2 foundation plus `transition_overrides`. RLS is enabled on
  every table; every policy is scoped `to authenticated`; `anon` has no table
  privileges.
- Columns added after the schema document was locked:
  `organization_memberships.account_origin`, `organizations.city` / `.state`,
  `teacher_schedule_preferences.active_bell_schedule_id`, `lessons.warmup`, and
  dual ownership on `school_year_calendars`.
- Privileged (`SECURITY DEFINER`) write functions, all `authenticated`-only:
  `bootstrap_organization`, `join_existing_school`, `import_bell_schedule`.
- `public.rls_auto_enable` is a pre-existing function not created by any Falcon Deck
  migration. Its origin is unconfirmed; it is deliberately left untouched.

## Code status

- **Authentication and organization onboarding are live.** `proxy.ts` refreshes the
  session; `lib/auth/dal.ts` resolves identity and the active organization;
  `lib/auth/actions.ts` implements sign in/up/out, password reset, organization
  selection, creating a school, and joining an existing one. The `(app)` route group
  and `/present` both require a resolved organization. `/demo/*` is public.
- **The cloud cutover has happened.** `lib/store/selectDataRepository.ts` picks the
  repository from the resolved data authority (`lib/auth/dataAuthority.ts`):
  - `cloud-ready` → `SupabaseDataRepository`, children blocked until loaded
  - `local` (a `legacy_import` membership whose migration has not completed) →
    `LocalStorageDataRepository`
  - anonymous / no membership / needs selection → `LocalStorageDataRepository`
- **`SupabaseDataRepository.save()` is not transactional.** It diffs two snapshots
  and issues sequential per-table writes, serialized and coalesced to one in flight.
  A failure can leave a partial write; the rows that save set out to change are
  re-read before the next save, and the rest of the cached baseline is kept. The
  two one-row-per-teacher tables are written column by column. Connected writes that must be all-or-nothing go through an RPC instead
  (`import_bell_schedule`; `complete_setup` once applied).
- **No cross-tab or cross-device change detection for cloud data.** The Supabase
  repository only reports sign-out.
- **Local-data migration** (`lib/data/migration/*`, `MigrationSetupCard`,
  `RestoreBackupCard`) serves legacy accounts.
- **Setup today:** `/setup` (derived checklist via `getOnboardingStatus`) and
  `/setup/schedule`, enforced by `ActiveScheduleGate` for cloud accounts with no
  active schedule.
- **Streamlined onboarding:** the persistence foundation exists
  (`lib/onboarding/setup*.ts`, `lib/data/supabaseSetupRepository.ts`) and is tested.
  Nothing calls it yet; no screen or redirect has changed.
- **No service-role key is used by application code.**

## Known deviations from the guardrails

- `components/onboarding/MigrationSetupCard.tsx` constructs a Supabase browser
  client itself. It is the only component that does.
  `scripts/verify-onboarding-setup-foundation.ts` pins that list so it cannot grow
  unnoticed.
- `lib/data/supabase.types.ts` is generated and has not been regenerated since
  before `import_bell_schedule`. Newer RPCs are called through narrow local types.

## Verification

- `npm run verify` — offline suite. Includes `verify:onboarding-setup-db` and
  `verify:onboarding-setup-concurrency`, which start a throwaway local PostgreSQL 17
  server (`scripts/support/testDatabase.ts`, via the `embedded-postgres` dev
  dependency), apply every migration to it, and never connect to Supabase.
- `verify:stale-tab-save-safety` (also in `npm run verify`, same local server) —
  a stale tab cannot overwrite or delete rows it never loaded, and unsaved edits
  survive a failed save. See `docs/ONBOARDING_SETUP_ARCHITECTURE.md` §9.2.
- `npm run verify:supabase-migration` — **runs against the production project**
  using two dedicated test accounts. Not part of `npm run verify`.
- Not in `npm run verify`: `verify:supabase-save-serialization`,
  `verify:bell-schedule-import-stage-e`,
  `verify:bell-schedule-import-stage-e-rpc-scoping`.

Failing on `main` as of `7a638bc`, before and independent of the onboarding work:

- `verify:classroom` — 1 check ("Live Mode has no separate materials-rendering code
  of its own"). Because `npm run verify` chains with `&&`, it stops here; every
  later script has to be run on its own until this is fixed.
- `verify:demo` — 1 check ("DemoAppDataProvider never imports the real
  localStorage-backed repository singleton").
- `npm run lint` — 4 `react-hooks/set-state-in-effect` errors
  (`CopyLessonPanel`, `LessonsScreen`, `BellScheduleImportPanel`) and 11 warnings.

## Migration version reconciliation (resolved in the repository by PR #5)

**Status (2026-10-14).**
- **Done:** PR #5 renamed the two files to production's versions, with contents
  byte-for-byte unchanged and the two references updated. It was merged to `main` as
  `ecb7467` and merged into this branch.
- **Production:** its migration history was not touched.
- **Completed afterwards:** staging's history relabel (2026-10-14: 30 records, 2
  corrected, 0 old). The production dry run listed exactly the three onboarding
  migrations (2026-10-16, Supabase CLI v2.118.0).

The original analysis follows.

**The mismatch.** Same two migrations, same names, different version numbers:

| Name | Repository before PR #5 | Recorded in production |
|---|---|---|
| `transition_content_stage_b_lessons_warmup` | `20260927150000` | `20260928002032` |
| `transition_content_stage_b_transition_overrides` | `20260927150100` | `20260928002124` |

Checked read-only on 2026-10-10: the SQL production recorded for each version is
the SQL in the corresponding file, comments aside. The schema is correct; only the
bookkeeping disagrees. The Supabase CLI matches by version, so it would report two
local files as unapplied and two remote versions as unknown, and `db push` would
try to re-run both files (the first would fail on `column "warmup" already exists`).

**Plan — change the repository, not production.**

1. In its own PR, rename the two files to the production versions, with no change
   to their contents:
   - `20260927150000_…lessons_warmup.sql` → `20260928002032_…lessons_warmup.sql`
   - `20260927150100_…transition_overrides.sql` → `20260928002124_…transition_overrides.sql`

   Both new names still sort between `20260926013603` and `20261003195952`, and in
   the same order relative to each other, so a from-scratch apply is unchanged.
2. Update the two places that name the old file:
   `lib/data/supabaseMapping.ts` (a comment) and
   `scripts/verify-transition-content-stage-b.ts` (reads the file by path).
3. Verify without writing anything:
   - `npm run verify:onboarding-setup-db` — applies all migrations from scratch.
   - `npm run verify:transition-content-stage-b`.
   - `supabase migration list --linked` — every row should show the same version
     locally and remotely, except the three unapplied onboarding migrations.
   - `supabase db push --dry-run` — should list only those three.
4. Only after step 3 is clean is a real `db push` safe to consider, as its own
   decision.

**Do not** use `supabase migration repair` for this. It would make the same numbers
agree by rewriting production's migration history table, which is the riskier side
to change and is unnecessary when a file rename achieves the same thing.

## Vercel preview builds

**Update (2026-10-14).** Preview now points at a separate staging project,
`falcondeck-staging` (`fkqplulzwchunhthyoym`). `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set for Preview only, so preview builds
succeed (PR #4's did). `FALCON_DECK_SESSION_SECRET` has its own value only for
`feature/streamlined-onboarding-foundation`; other branches' previews still share
production's, which is set on one record covering both environments. The Google
Drive variables are still shared. Staging's Auth Site URL and Redirect URL are set
for PR #4's preview address. The history below is kept for context.

Before that update, every preview deployment failed and production deployments
succeeded.

**Cause.** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are
set for the **Production** environment only. During `next build`, prerendering an
authenticated route runs `createSupabaseServerClient()`, which throws when either
is missing — before the route reaches `cookies()` and opts out of prerendering.
The four other variables (`GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
`GOOGLE_DRIVE_REDIRECT_URI`, `FALCON_DECK_SESSION_SECRET`) already target Preview.

**Needed for a successful preview build:** both `NEXT_PUBLIC_SUPABASE_*` variables
present in the **Preview** environment. Neither is a secret (both are shipped to
the browser), but which project they point at is a real decision:

- *A separate Supabase project for previews (recommended).* Previews then never
  touch production data, unapplied migrations can be applied there first, and it is
  also the missing environment for `docs/ONBOARDING_SETUP_ARCHITECTURE.md` §8.3.
  That project's Auth "Redirect URLs" must allow the preview domains, since sign-up
  and password-reset links are built from the request's own origin.
- *The production project.* The build passes, but every preview then signs in real
  users and reads and writes production data, and any preview of code that needs an
  unapplied migration fails at runtime.

No Vercel or Supabase configuration was changed.

## Architectural guardrails

- Everything above the data layer talks to `DataRepository` (operational data) or
  `SetupRepository` (guided-setup drafts). Components do not import `@supabase/*`.
- Teacher saves never write organization-owned rows.
- Onboarding readiness is derived from real data, never stored.
- Service-role credentials never reach the browser.
- Do not apply migrations to production, merge, or deploy without an explicit
  instruction to do so.

## Cleanup backlog

Tracked, not urgent. Nothing here affects teachers.

- **Five empty test organizations in production.**
  - Left by the live checks on 2026-10-16, all named "Falcon Deck … Test …" or
    "Falcon Deck release check (disposable)". Each has no memberships, schedules,
    preferences or drafts.
  - Signed-in users cannot delete organizations, so removing them needs a privileged
    delete. Not done yet.
  - Ids: `e4c5df20-ff7d-4a3b-b7d4-e9a90fa476ba`, `e38bb0ae-2160-4f06-84f2-cd12707dd665`,
    `0e684eeb-406b-4a4c-9a2b-1c171bbae8fd`, `e2a6e309-db63-4a40-be55-7950a3674d0e`,
    `9355fada-4d97-4876-988c-189d2b0b8373`.
  - Delete them with a guarded statement that removes only rows still without a
    membership:

    ```sql
    delete from public.organizations
    where id in (...the five ids...)
      and not exists (select 1 from public.organization_memberships m
                      where m.organization_id = organizations.id);
    ```
- **Preview's session secret.** `FALCON_DECK_SESSION_SECRET` is shared between
  Production and Preview on one Vercel record. Only previews of
  `feature/streamlined-onboarding-foundation` have their own value; that branch is now
  merged, so the override can go once the record is split.
- **Older helper functions callable by `anon`.** Supabase's security advisor reports
  `app_is_admin`, `app_is_member`, `app_owns_membership`,
  `app_owns_membership_in_org` and `handle_new_user` as executable by `anon`. They
  were created by earlier migrations, not the onboarding work. Review them separately.
