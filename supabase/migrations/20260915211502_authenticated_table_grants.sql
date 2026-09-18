-- Falcon Deck V2 - corrective migration.
--
-- Closes a gap discovered running the live Supabase Data Repository
-- integration suite for the first time: every one of the 19 public tables
-- had RLS policies but no base object-level GRANT for `authenticated` (or
-- `anon`) at all. In Postgres, CREATE TABLE grants nothing to PUBLIC by
-- default (unlike functions, which default to EXECUTE-for-PUBLIC - the
-- opposite problem, already closed by
-- 20260910010824_function_privilege_hardening.sql). RLS policies only
-- decide *which rows* a role may see/write once that role already has the
-- underlying table privilege; without it, every query fails with
-- "permission denied for table X" before RLS is ever evaluated. This was
-- invisible until now because every previous verification used either a
-- SECURITY DEFINER function (runs as the function owner, not the caller)
-- or the Supabase CLI's own privileged connection (bypasses grants
-- entirely) - never a plain authenticated-role query via PostgREST/
-- supabase-js, which is exactly what SupabaseDataRepository needs.
--
-- Grants below are derived directly from each table's own RLS policies
-- (see the audit in the session that produced this migration) - a
-- privilege is granted here only where a corresponding RLS policy exists
-- for `authenticated` to act on. `anon` receives nothing: no table in this
-- schema has any RLS policy scoped to `anon`, and none should.
--
-- schema-level USAGE on `public` for both roles was already correctly in
-- place (standard Supabase project bootstrap, not something any Falcon
-- Deck migration needed to touch) - confirmed via has_schema_privilege()
-- before writing this migration, not assumed.

-- Full CRUD: every one of these 17 tables has all four RLS policies
-- (SELECT/INSERT/UPDATE/DELETE) already defined for `authenticated`.
grant select, insert, update, delete on table public.organization_memberships to authenticated;
grant select, insert, update, delete on table public.organization_settings to authenticated;
grant select, insert, update, delete on table public.courses to authenticated;
grant select, insert, update, delete on table public.class_sections to authenticated;
grant select, insert, update, delete on table public.bell_schedules to authenticated;
grant select, insert, update, delete on table public.schedule_blocks to authenticated;
grant select, insert, update, delete on table public.schedule_block_overrides to authenticated;
grant select, insert, update, delete on table public.teacher_period_assignments to authenticated;
grant select, insert, update, delete on table public.school_year_calendars to authenticated;
grant select, insert, update, delete on table public.school_calendar_exceptions to authenticated;
grant select, insert, update, delete on table public.lessons to authenticated;
grant select, insert, update, delete on table public.lesson_class_sections to authenticated;
grant select, insert, update, delete on table public.library_resources to authenticated;
grant select, insert, update, delete on table public.library_resource_courses to authenticated;
grant select, insert, update, delete on table public.class_presentation_settings to authenticated;
grant select, insert, update, delete on table public.classroom_experience_settings to authenticated;
grant select, insert, update, delete on table public.teacher_schedule_preferences to authenticated;

-- Narrower: organizations has only a SELECT policy for authenticated
-- ("organizations_select_any_authenticated") - INSERT/UPDATE/DELETE are
-- deliberately left to trusted/service-role tooling (see
-- 20260829120100_organizations.sql's own comment), so no write privilege
-- is granted here.
grant select on table public.organizations to authenticated;

-- Narrower: profiles has SELECT and UPDATE policies for authenticated
-- ("profiles_select_own", "profiles_update_own") but no INSERT policy -
-- row creation happens exclusively via handle_new_user()'s SECURITY
-- DEFINER trigger at signup, which does not need this grant - and no
-- DELETE policy at all.
grant select, update on table public.profiles to authenticated;
