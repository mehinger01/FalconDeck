-- Falcon Deck V2 - Authentication & Organization Onboarding, Phase 2.
--
-- Problem this closes: organization_memberships' INSERT policy is
-- admin-only (organization_memberships_insert_admin_only, migration 3) -
-- by design, so an ordinary signed-in user can never grant themselves a
-- membership via RLS-governed writes alone. But the very first membership
-- for a brand new organization has no existing admin to perform that
-- insert. bootstrap_organization() is the single, narrow, audited escape
-- hatch for exactly that one moment - not a general-purpose privilege
-- escalation, and not a precedent for adding more SECURITY DEFINER
-- functions casually elsewhere.
--
-- Why SECURITY DEFINER is necessary: this function's two INSERTs
-- (organizations, then organization_memberships) execute as this
-- function's owner - the same privileged role that owns both tables from
-- their CREATE TABLE migrations. A table owner bypasses RLS by default
-- (neither table has FORCE ROW LEVEL SECURITY set), which is exactly what
-- lets this function do the one legitimate write an ordinary authenticated
-- role's RLS-constrained access could never do. Because RLS provides no
-- safety net inside this function's body, every input is validated and
-- every privileged value (id, role, status) is either generated or
-- hard-coded here, never accepted from the caller.

create function public.bootstrap_organization(organization_name text)
returns table (organization_id uuid, membership_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_trimmed_name text := btrim(organization_name);
  v_base_slug text;
  v_slug text;
  v_organization_id uuid;
  v_membership_id uuid;
begin
  -- (1) Identity: auth.uid() is NULL for an unauthenticated/anon caller.
  -- This is the only identity input this function trusts - never a
  -- caller-supplied user id, and never anything from user_metadata.
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  -- Resolve the caller's own profile row (created atomically at signup by
  -- handle_new_user(), migration 1). This should always exist for a real
  -- authenticated user; the check is defense-in-depth, not the primary
  -- identity check.
  if not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'No profile found for the current user.' using errcode = '28000';
  end if;

  -- (2) Serialize every bootstrap attempt by this same user for the
  -- duration of this transaction. Without this, two concurrent first-time
  -- calls from the same brand-new user (zero existing membership rows to
  -- lock) could both pass the zero-membership check below before either
  -- commits, creating two organizations for one user. The advisory lock
  -- closes that window: the second concurrent call blocks here until the
  -- first transaction commits or rolls back, then re-evaluates the
  -- membership check below and is correctly rejected.
  perform pg_advisory_xact_lock(hashtextextended('bootstrap_organization:' || v_user_id::text, 0));

  -- (3) The core guarantee: reject outright if the caller already has any
  -- active membership, anywhere. This is what prevents a signed-in user
  -- from creating a second organization, and is unconditional - it does
  -- not matter which organization the existing membership belongs to.
  if exists (
    select 1
    from public.organization_memberships m
    where m.user_id = v_user_id
      and m.status = 'active'
  ) then
    raise exception 'You already belong to an organization.' using errcode = '42501';
  end if;

  -- (4) Validate the organization name server-side. Client-side validation
  -- is a UX nicety only, never trusted here.
  if v_trimmed_name is null or v_trimmed_name = '' then
    raise exception 'Organization name is required.' using errcode = '22023';
  end if;
  if length(v_trimmed_name) > 200 then
    raise exception 'Organization name is too long.' using errcode = '22023';
  end if;

  -- (5) Generate the slug internally - never accepted from the caller.
  -- The random suffix makes collisions across different schools with
  -- similar names vanishingly unlikely; organizations.slug's own UNIQUE
  -- constraint is the hard backstop (a collision fails the insert below,
  -- which rolls back this entire function call atomically - no partial
  -- organization row survives without its membership).
  v_base_slug := btrim(lower(regexp_replace(v_trimmed_name, '[^a-zA-Z0-9]+', '-', 'g')), '-');
  if v_base_slug = '' then
    v_base_slug := 'school';
  end if;
  v_slug := left(v_base_slug, 40) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);

  -- (6) Create the organization. id is generated internally
  -- (organizations.id's own default); no caller-supplied organization_id
  -- is ever accepted.
  insert into public.organizations (name, slug)
  values (v_trimmed_name, v_slug)
  returning id into v_organization_id;

  -- (7) Create exactly one membership: this caller, this new
  -- organization, role and status hard-coded. No caller-supplied
  -- user_id/organization_id/role/status/membership_id is ever accepted -
  -- every value here is either generated moments ago in this same
  -- function call or a literal constant.
  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_organization_id, v_user_id, 'admin', 'active')
  returning id into v_membership_id;

  -- Both inserts above ran inside this single function invocation with no
  -- intervening commit - a plpgsql function body has no way to partially
  -- commit itself, so any exception raised anywhere above (including a
  -- unique-violation on the second insert) rolls back the first insert
  -- too. Atomicity here is a property of how Postgres executes functions,
  -- not something this code has to implement.
  return query select v_organization_id, v_membership_id;
end;
$$;

comment on function public.bootstrap_organization(text) is
  'Narrowly-scoped SECURITY DEFINER bootstrap: creates a new organization and the calling user''s initial admin membership, atomically, only when the caller currently has zero active memberships. The only privileged function in this schema - see the function body comments for the full constraint list.';

-- New functions default to EXECUTE granted to PUBLIC in Postgres - close
-- that immediately, matching the pattern established in
-- 20260910010824_function_privilege_hardening.sql. Only `authenticated`
-- may call this; `anon` must never reach a SECURITY DEFINER function that
-- writes data.
revoke execute on function public.bootstrap_organization(text) from public;
revoke execute on function public.bootstrap_organization(text) from anon;
grant execute on function public.bootstrap_organization(text) to authenticated;
