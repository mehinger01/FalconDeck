# Falcon Deck — Current State

Handoff snapshot for a fresh Claude Code session. Read this before starting any new work.

## Repo / deployment identity

- **Git commit:** `047f7df74b4e681e6c9f124d28ad0d1970c4e963`
- **GitHub repo:** `mehinger01/FalconDeck`
- **Supabase project ref:** `rlfydgbololkbrcloneb`
- **Working tree:** clean (nothing staged, nothing uncommitted)

## Supabase status

- All **10 migrations** are applied live against the linked Supabase project:
  - 9 schema-foundation migrations (`profiles`, `organizations`, `organization_memberships`, `organization_settings`, `courses`, `class_sections`, `bell_schedules`, `schedule_blocks`/`schedule_block_overrides`, `teacher_period_assignments`)
  - 1 post-deploy hardening migration (`function_privilege_hardening`)
- RLS is enabled on every table; every policy is scoped `to authenticated`.
- Function-privilege hardening is applied: RLS helper functions (`app_is_member`, `app_is_admin`, `app_owns_membership`, `app_owns_membership_in_org`) have `EXECUTE` revoked from `anon`/`PUBLIC` and granted only to `authenticated`; `handle_new_user()` has `EXECUTE` revoked from `PUBLIC` entirely; `prevent_membership_identity_change()` has an explicit `search_path = pg_catalog`.
- `public.rls_auto_enable` is a pre-existing function, not created by any Falcon Deck migration — its origin/ownership is unconfirmed. Deliberately left untouched pending its own investigation.
- Vercel public env vars are configured:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Code status

- `lib/supabase/browserClient.ts` and `lib/supabase/serverClient.ts` exist and are committed — each exports a client factory using the publishable key, neither is imported by any route or component yet.
- `@supabase/ssr` and `@supabase/supabase-js` are committed dependencies (`package.json`/`package-lock.json`).
- **The live app still uses `LocalStorageDataRepository` exclusively.** `AppDataProvider` imports and defaults to `dataRepository` from `lib/data/localStorageRepository.ts`; no conditional/env-based repository selection exists anywhere.
- Supabase clients are **not** wired into any route or component.
- **No service-role usage** is wired into the app anywhere — `SUPABASE_SERVICE_ROLE_KEY` is documented in `.env.example` but nothing in application code references it.
- **No repository cutover has occurred.** `SupabaseDataRepository` does not exist yet — only mentioned in forward-looking doc comments.

## Next milestone: Authentication & Organization Onboarding

Workflow: **VALIDATE → DESIGN → IMPLEMENT → REVIEW**

**First task in the next session: perform VALIDATE only.** Do not modify any files until the validation findings have been reviewed.

## Architectural guardrails

- Preserve the existing `DataRepository` abstraction — everything above it (reducer, screens) only ever talks to that interface.
- Build `SupabaseDataRepository` behind the existing interface later; don't shortcut around it.
- Do not couple UI components directly to Supabase (no component/screen should import `@supabase/*` or the client factories directly).
- Keep `LocalStorageDataRepository` as the known-good path until the Supabase repository and migration are actually tested.
- Do not overbuild admin, invitations, multi-org switching, or district workflows yet — this milestone is authentication and single-organization onboarding only.
- Do not expose service-role credentials to the browser, ever.
