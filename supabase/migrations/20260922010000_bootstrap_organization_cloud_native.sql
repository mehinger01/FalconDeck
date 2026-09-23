-- Falcon Deck V2 - private-beta blocker fix, Stage C (write path).
--
-- bootstrap_organization() now explicitly writes account_origin =
-- 'cloud_native' on the membership row it creates, instead of relying on
-- Stage A's column default (organization_memberships.account_origin's
-- `default 'cloud_native'`, added in
-- 20260922000000_organization_memberships_account_origin.sql). The
-- default already made this correct before this migration - a brand-new
-- membership already derived 'cloud-ready' authority regardless. This
-- migration is about explicit application intent, not correctness: a
-- brand-new membership's origin should be a decision bootstrap_organization
-- states on purpose in its own INSERT, not something that happens to fall
-- out of a schema default it never mentions.
--
-- local_data_migrated_at is untouched - still never set here, still NULL
-- for every cloud_native row, exactly as before. It is never fabricated,
-- in this migration or any other.
--
-- CREATE OR REPLACE FUNCTION requires restating the function's entire
-- body (Postgres has no way to patch a single statement in place) - only
-- the membership INSERT in step (7) actually changes; everything else
-- below is identical to the function as created in
-- 20260914140000_bootstrap_organization.sql. GRANT/REVOKE and the
-- function's own COMMENT are unaffected by CREATE OR REPLACE (the
-- function's signature is unchanged, so its OID - and everything attached
-- to that OID - persists) and are not restated here.

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
  -- organization, role and status hard-coded, account_origin explicitly
  -- 'cloud_native' - every brand-new membership created through this
  -- function has no local browser data to migrate by definition, so it
  -- states that fact itself rather than leaving it to
  -- organization_memberships.account_origin's column default. No
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
