# Falcon Deck — Current State

Handoff snapshot for a fresh session. Read this before starting any new work.
Reconciled against the code and the live migration list on 2026-10-10; the previous
version of this file described the app before the cloud cutover and was wrong on
most points below.

## Repo / deployment identity

- **GitHub repo:** `mehinger01/FalconDeck`
- **`main` at reconciliation:** `7a638bc` (PR #3, Present/Preview crash reporting)
- **Supabase project ref:** `rlfydgbololkbrcloneb` — the only project. It is
  production. There is no separate development or staging project.

## Supabase status

- **27 migrations are applied to production**, matching the 27 committed before the
  onboarding work, by name. Two differ by version only:
  `transition_content_stage_b_lessons_warmup` and
  `transition_content_stage_b_transition_overrides` are recorded in production as
  `20260928002032` / `20260928002124` but are named `20260927150000` /
  `20260927150100` in `supabase/migrations`. A `supabase db push` would treat those
  two files as unapplied. See "Migration version reconciliation" below.
- **Not applied anywhere:** `20261010210000_onboarding_setup_stage_a_schema.sql` and
  `20261010210100_onboarding_setup_stage_b_rpcs.sql` (streamlined onboarding — see
  `docs/ONBOARDING_SETUP_ARCHITECTURE.md`).
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
  A failure can leave a partial write; the cached baseline is discarded when that
  happens. Connected writes that must be all-or-nothing go through an RPC instead
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
- `npm run repro:stale-tab-after-setup` — reproduces an **open** risk
  (`docs/ONBOARDING_SETUP_ARCHITECTURE.md` §9.2). Exits 0 when the problem is still
  there. Not part of `npm run verify`.
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

## Migration version reconciliation (plan — nothing done yet)

**The mismatch.** Same two migrations, same names, different version numbers:

| Name | In `supabase/migrations` | Recorded in production |
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
     locally and remotely, except the two unapplied onboarding migrations.
   - `supabase db push --dry-run` — should list only those two.
4. Only after step 3 is clean is a real `db push` safe to consider, as its own
   decision.

**Do not** use `supabase migration repair` for this. It would make the same numbers
agree by rewriting production's migration history table, which is the riskier side
to change and is unnecessary when a file rename achieves the same thing.

## Vercel preview builds

Every preview deployment fails; production deployments succeed.

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
