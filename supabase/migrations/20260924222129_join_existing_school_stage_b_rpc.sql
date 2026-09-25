-- Falcon Deck V2 - join-existing-school feature, Stage B (RPC only).
-- Depends on Stage A (20260924204130_join_existing_school_stage_a_schema.sql),
-- already applied. Adds no Stage C onboarding UI, no seed data, no RLS
-- redesign - membership creation remains RPC-only, exactly as today
-- (organization_memberships has no self-service INSERT policy; INSERT
-- requires app_is_admin(organization_id), confirmed by live audit before
-- this migration was written).
--
-- Two changes:
--   (A) CREATE OR REPLACE bootstrap_organization - the ONLY behavior change
--       is its advisory-lock key, moved from the function-specific
--       'bootstrap_organization:' || user_id to the shared
--       'organization_membership_creation:' || user_id domain. Every other
--       statement is restated verbatim from the live definition audited
--       immediately before writing this migration (identity, profile
--       check, active-membership rejection, name validation, slug
--       generation, organization insert, membership insert with
--       role='admin'/status='active'/account_origin='cloud_native', return
--       shape) - CREATE OR REPLACE requires restating the whole body,
--       Postgres has no way to patch a single statement in place, same as
--       20260922010000_bootstrap_organization_cloud_native.sql.
--   (B) NEW public.join_existing_school(target_organization_id uuid) -
--       same SECURITY DEFINER shape as bootstrap_organization, same
--       shared advisory-lock domain, same "at most one active membership"
--       guarantee, so a concurrent bootstrap-vs-join race by the same
--       brand-new user now serializes correctly against BOTH entry
--       points, not just against itself.
--
-- Why the shared lock domain matters: before this migration,
-- bootstrap_organization locked on a key no other function used. A
-- concurrent bootstrap_organization + (a not-yet-existing) join call by
-- the same brand-new user could both pass the "zero active membership"
-- check before either committed, each acquiring a different advisory
-- lock, and both succeed - creating two memberships for one user. Moving
-- both functions onto the identical lock key closes that window
-- structurally, the same way the existing single advisory lock already
-- closes the bootstrap-vs-bootstrap race.

-- (A) bootstrap_organization - lock-key correction only.
create or replace function public.bootstrap_organization(organization_name text)
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

  -- (2) Serialize every membership-creating attempt by this same user for
  -- the duration of this transaction - shared with join_existing_school
  -- (Stage B), not a bootstrap-specific key. Without this shared domain, a
  -- concurrent bootstrap_organization + join_existing_school call by the
  -- same brand-new user (zero existing membership rows to lock) could both
  -- pass the zero-membership check below before either commits, creating
  -- two memberships for one user. The shared lock closes that window: the
  -- second concurrent call, through either function, blocks here until the
  -- first transaction commits or rolls back, then re-evaluates the
  -- membership check below and is correctly rejected.
  perform pg_advisory_xact_lock(hashtextextended('organization_membership_creation:' || v_user_id::text, 0));

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
  -- organization, role and status hard-coded, account_origin explicitly
  -- 'cloud_native' - every brand-new membership created through this
  -- function has no local browser data to migrate by definition. No
  -- caller-supplied user_id/organization_id/role/status/account_origin/
  -- membership_id is ever accepted - every value here is either generated
  -- moments ago in this same function call or a literal constant.
  -- local_data_migrated_at is deliberately absent from this INSERT and
  -- stays NULL - it is never fabricated for a cloud_native row.
  insert into public.organization_memberships (organization_id, user_id, role, status, account_origin)
  values (v_organization_id, v_user_id, 'admin', 'active', 'cloud_native')
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

-- GRANT/REVOKE on bootstrap_organization are unaffected by CREATE OR
-- REPLACE (the function's signature is unchanged, so its OID - and
-- everything attached to that OID - persists). Audited live before this
-- migration was written: proacl = {postgres=X/postgres,authenticated=X/
-- postgres} - EXECUTE already correctly restricted to authenticated only,
-- no anon/PUBLIC grant exists. Not restated here; no repair needed.

-- (B) join_existing_school - new function, same shape and same shared
-- advisory-lock domain as bootstrap_organization above.
create or replace function public.join_existing_school(target_organization_id uuid)
returns table (organization_id uuid, membership_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
begin
  -- (1) Identity: same as bootstrap_organization - auth.uid() is the only
  -- trusted identity input, never a caller-supplied user id.
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'No profile found for the current user.' using errcode = '28000';
  end if;

  -- (2) Same advisory-lock DOMAIN as bootstrap_organization (not merely
  -- the same pattern) - see that function's own comment above for why a
  -- shared key, not a per-function one, is required to close the
  -- bootstrap-vs-join race for the same brand-new user.
  perform pg_advisory_xact_lock(hashtextextended('organization_membership_creation:' || v_user_id::text, 0));

  -- (3) Same unconditional guarantee as bootstrap_organization: reject if
  -- the caller already has any active membership, anywhere - independent
  -- of which organization it belongs to, and independent of whether that
  -- membership was created by this function or by bootstrap_organization.
  if exists (
    select 1
    from public.organization_memberships m
    where m.user_id = v_user_id
      and m.status = 'active'
  ) then
    raise exception 'You already belong to an organization.' using errcode = '42501';
  end if;

  -- (4) Validate the target organization exists. No caller-supplied
  -- organization row is ever created by this function - unlike
  -- bootstrap_organization, join_existing_school only ever attaches a
  -- membership to a pre-existing organizations row.
  if not exists (select 1 from public.organizations o where o.id = target_organization_id) then
    raise exception 'Organization not found.' using errcode = '22023';
  end if;

  -- (5) Create exactly one membership: this caller, the caller-supplied
  -- (now validated) organization, role/status/account_origin hard-coded -
  -- private-beta join semantics per the approved architecture: immediate
  -- role='teacher', status='active', never 'invited'. No caller-supplied
  -- user_id/role/status/account_origin/membership_id is ever accepted -
  -- target_organization_id is the only input this function takes.
  -- local_data_migrated_at is deliberately absent - never fabricated for a
  -- cloud_native row, identical to bootstrap_organization.
  insert into public.organization_memberships (organization_id, user_id, role, status, account_origin)
  values (target_organization_id, v_user_id, 'teacher', 'active', 'cloud_native')
  returning id into v_membership_id;

  return query select target_organization_id, v_membership_id;
end;
$$;

comment on function public.join_existing_school(uuid) is
  'Private-beta join-existing-school entry point. Accepts only target_organization_id; identity comes solely from auth.uid(). Creates role=teacher, status=active, account_origin=cloud_native immediately - no invited/pending state exists yet (deferred to the admin-governance milestone). Shares its advisory-lock domain with bootstrap_organization so the two entry points serialize against each other, not just against themselves.';

revoke execute on function public.join_existing_school(uuid) from public;
revoke execute on function public.join_existing_school(uuid) from anon;
grant execute on function public.join_existing_school(uuid) to authenticated;
