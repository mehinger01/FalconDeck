-- Post-deploy hardening: addresses Supabase Security Advisor findings from
-- the first production db push (migrations 20260829120000-20260829120800
-- are already applied - this is a new migration, not an edit to those
-- files).
--
-- Findings addressed:
--   1. public.prevent_membership_identity_change has a mutable search_path.
--   2. app_is_admin / app_is_member / app_owns_membership /
--      app_owns_membership_in_org / handle_new_user are directly executable
--      by anon/authenticated via Postgres's default "new functions grant
--      EXECUTE to PUBLIC" behavior - none of our 9 migrations ever revoked
--      it.
--
-- NOT addressed here: public.rls_auto_enable. It does not exist in any of
-- our migrations - it is not a Falcon Deck function, most likely a
-- Supabase-platform-managed one. Left completely untouched pending its own
-- investigation.

-- (1) Pin search_path on the identity-immutability trigger. Its body only
-- reads NEW/OLD row fields - no schema object references at all - so
-- pg_catalog (rather than public) is the correct, minimal search_path: the
-- function needs no access to public's objects, only Postgres's own
-- built-ins, and pg_catalog closes the linter finding without granting any
-- schema lookup this function doesn't use.
create or replace function public.prevent_membership_identity_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
    raise exception 'organization_id and user_id are immutable on organization_memberships';
  end if;
  return new;
end;
$$;

-- (2) RLS helper functions: `authenticated` MUST keep EXECUTE (every policy
-- in this schema is scoped `to authenticated` and calls one of these inside
-- USING/WITH CHECK - revoking would break every table). `anon` does not:
-- no policy is ever evaluated for `anon`, so it has no legitimate need to
-- call these directly.
revoke execute on function public.app_is_member(uuid) from public;
revoke execute on function public.app_is_admin(uuid) from public;
revoke execute on function public.app_owns_membership(uuid) from public;
revoke execute on function public.app_owns_membership_in_org(uuid, uuid) from public;

grant execute on function public.app_is_member(uuid) to authenticated;
grant execute on function public.app_is_admin(uuid) to authenticated;
grant execute on function public.app_owns_membership(uuid) to authenticated;
grant execute on function public.app_owns_membership_in_org(uuid, uuid) to authenticated;

-- (3) handle_new_user: fires only via the on_auth_user_created trigger.
-- Trigger firing does not re-check the DML-issuing role's EXECUTE grant on
-- the function (only the trigger's creator needed it), and Postgres refuses
-- a direct call to a `returns trigger` function outright regardless of
-- grants. No client role needs this; revoking the default PUBLIC grant has
-- zero effect on signup.
revoke execute on function public.handle_new_user() from public;
