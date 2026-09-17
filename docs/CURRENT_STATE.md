# Falcon Deck — Current State

Handoff snapshot for a fresh Claude Code session. Read this before starting any new work.

## Repo / deployment identity

- **Git commit:** `047f7df74b4e681e6c9f124d28ad0d1970c4e963`
- **GitHub repo:** `mehinger01/FalconDeck`
- **Supabase project ref:** `rlfydgbololkbrcloneb`
- **Working tree:** clean (nothing staged, nothing uncommitted)

## Supabase status

- **19 tables + 1 privileged function** are applied live against the linked Supabase project across 15 migrations:
  - 9 schema-foundation migrations (`profiles`, `organizations`, `organization_memberships`, `organization_settings`, `courses`, `class_sections`, `bell_schedules`, `schedule_blocks`/`schedule_block_overrides`, `teacher_period_assignments`)
  - 1 post-deploy hardening migration (`function_privilege_hardening`)
  - 4 schema-completion migrations (`school_year_calendars`/`school_calendar_exceptions`, `lessons`/`lesson_class_sections`, `library_resources`/`library_resource_courses`, `class_presentation_settings`/`classroom_experience_settings`/`teacher_schedule_preferences`) — the full 19-table V2 foundation schema, per `docs/V2_DATABASE_SCHEMA.md`
  - 1 `bootstrap_organization` migration — see below
- RLS is enabled on every table; every policy is scoped `to authenticated`.
- Function-privilege hardening is applied: RLS helper functions (`app_is_member`, `app_is_admin`, `app_owns_membership`, `app_owns_membership_in_org`) have `EXECUTE` revoked from `anon`/`PUBLIC` and granted only to `authenticated`; `handle_new_user()` has `EXECUTE` revoked from `PUBLIC` entirely; `prevent_membership_identity_change()` has an explicit `search_path = pg_catalog`.
- **`bootstrap_organization(organization_name text)`** (`supabase/migrations/20260914140000_bootstrap_organization.sql`) is the one privileged (`SECURITY DEFINER`) write function in the schema — see `docs/V2_DATABASE_SCHEMA.md` §2.20. Lets an authenticated user with zero active memberships atomically create a new organization and their own initial admin membership, without weakening `organization_memberships`' admin-only INSERT policy. `EXECUTE` is `authenticated`-only.
- `public.rls_auto_enable` is a pre-existing function, not created by any Falcon Deck migration — its origin/ownership is unconfirmed. Deliberately left untouched pending its own investigation.
- Vercel public env vars are configured:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Code status

- Authentication is wired up (Authentication & Organization Onboarding milestone, Phases 1–2): `proxy.ts` + `lib/supabase/proxy.ts` refresh the session; `lib/auth/dal.ts` resolves identity/active-organization state; `lib/auth/actions.ts` implements sign in/up/out, password reset, organization selection, and organization bootstrap (via the `bootstrap_organization` RPC above); `app/login`, `app/onboarding`, `app/auth/*` are the corresponding routes. The `(app)` route group is gated on a resolved active organization; `/present` (now under the sibling `(presentation)` route group, `app/(presentation)/present/layout.tsx`) is gated the same way, without the NavBar/app-shell chrome; `/demo/*` remains public/unauthenticated.
- `lib/supabase/browserClient.ts` and `lib/supabase/serverClient.ts` are committed; `serverClient.ts` is now used by the auth code above, `browserClient.ts` remains unused (all auth is server-side).
- `@supabase/ssr` and `@supabase/supabase-js` are committed dependencies (`package.json`/`package-lock.json`).
- **The live app still uses `LocalStorageDataRepository` exclusively.** `AppDataProvider` imports and defaults to `dataRepository` from `lib/data/localStorageRepository.ts`; no conditional/env-based repository selection exists anywhere. Authentication and organization context are established independently of, and do not yet influence, which repository `AppDataProvider` uses.
- **No service-role usage** is wired into the app anywhere — `SUPABASE_SERVICE_ROLE_KEY` is documented in `.env.example` but nothing in application code references it. `bootstrap_organization` uses the ordinary authenticated server client, not a service-role client.
- **No repository cutover has occurred.** `SupabaseDataRepository` does not exist yet — only mentioned in forward-looking doc comments.

## Next milestone

Authentication & Organization Onboarding Phases 1 (auth infrastructure) and 2 (organization bootstrap) are complete. Remaining, not yet started: `SupabaseDataRepository`, `localStorage` → Supabase data migration, and connecting the newly-established organization context to the rest of the app.

## Architectural guardrails

- Preserve the existing `DataRepository` abstraction — everything above it (reducer, screens) only ever talks to that interface.
- Build `SupabaseDataRepository` behind the existing interface later; don't shortcut around it.
- Do not couple UI components directly to Supabase (no component/screen should import `@supabase/*` or the client factories directly).
- Keep `LocalStorageDataRepository` as the known-good path until the Supabase repository and migration are actually tested.
- Do not overbuild admin, invitations, multi-org switching, or district workflows yet — this milestone is authentication and single-organization onboarding only.
- Do not expose service-role credentials to the browser, ever.
