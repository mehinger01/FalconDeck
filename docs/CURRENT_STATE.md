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
  two files as unapplied. Resolve before the next push.
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

- `npm run verify` — offline suite. Includes `verify:onboarding-setup-db`, which
  applies every migration to an in-memory Postgres (PGlite) and never connects to
  Supabase.
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

## Architectural guardrails

- Everything above the data layer talks to `DataRepository` (operational data) or
  `SetupRepository` (guided-setup drafts). Components do not import `@supabase/*`.
- Teacher saves never write organization-owned rows.
- Onboarding readiness is derived from real data, never stored.
- Service-role credentials never reach the browser.
- Do not apply migrations to production, merge, or deploy without an explicit
  instruction to do so.
