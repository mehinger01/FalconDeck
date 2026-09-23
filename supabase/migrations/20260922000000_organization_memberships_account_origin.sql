-- Falcon Deck V2 - private-beta blocker fix, Stage A (schema only).
--
-- Closes the bug where a brand-new membership's local_data_migrated_at
-- defaulted to NULL, making it structurally indistinguishable from a
-- genuine legacy Falcon Deck account still waiting to migrate real local
-- data - see the account-origin architecture review (2026-09-22) for the
-- full diagnosis.
--
-- account_origin becomes the single signal for "does migration even apply
-- to this membership." local_data_migrated_at keeps exactly one meaning -
-- has migration finished - and is never fabricated or inferred from:
-- this migration does not set local_data_migrated_at for any row, and
-- does not derive account_origin from it either. Reading account_origin +
-- local_data_migrated_at together (Stage B) is what replaces the old
-- single-column overload:
--   cloud_native + null timestamp        -> cloud-ready
--   legacy_import + null timestamp       -> local (migration pending)
--   legacy_import + non-null timestamp   -> cloud-ready (migration complete)
--   cloud_native + non-null timestamp    -> schema-tolerated, never
--                                           manufactured by normal code
--
-- Deliberately added nullable, with no default, first: a default at
-- ADD COLUMN time would silently classify every existing row as
-- cloud_native before this file gets a chance to check anything, which is
-- exactly the "unknown legacy row loses its automatic migration path"
-- failure mode this migration exists to prevent. NOT NULL and the default
-- are only added at the end, after two separate checks pass.
--
-- This migration is written against, and only safe to apply against, the
-- exact production membership set verified read-only on 2026-09-22:
-- exactly two rows, Ogemaw Heights High School and Test School, below.
-- Two checks enforce that assumption rather than trust it:
--   (1) an exact-set preflight, immediately after ADD COLUMN and before
--       either backfill UPDATE, that fails unless the table has exactly
--       these two rows, by id - it fails just as loudly on a missing
--       known row (e.g. Ogemaw absent) as on an unexpected extra one,
--       which a "no NULLs remain" check alone cannot detect;
--   (2) the post-backfill NULL check, kept as defense-in-depth in case a
--       row's account_origin is somehow still unset after the two
--       UPDATEs even though the preflight passed.
-- If either check fails, this migration fails loudly rather than
-- silently guessing at an unknown row's origin.

alter table public.organization_memberships
  add column account_origin text
    check (account_origin in ('cloud_native', 'legacy_import'));

comment on column public.organization_memberships.account_origin is
  'Answers whether legacy migration applies to this membership at all - cloud_native: no legacy-migration concept, always cloud-authoritative regardless of local_data_migrated_at. legacy_import: has (or had) real local browser data to migrate - authority derives from local_data_migrated_at (null = migration pending, local-authoritative; non-null = migration complete, cloud-authoritative). local_data_migrated_at records only whether that migration has actually completed - it never independently implies account_origin, and account_origin is never inferred from it. Set explicitly at membership creation (bootstrap_organization) or by a future explicit legacy-import action.';

-- Exact-set preflight - runs before either backfill UPDATE below. Fails
-- the whole migration (and rolls back the ADD COLUMN above with it) if
-- the table doesn't contain precisely the two verified rows: wrong total
-- count, Ogemaw's id missing, or Test School's id missing all raise.
-- Deliberately does not infer any row's account_origin from
-- local_data_migrated_at anywhere in this block.
do $$
begin
  if (
    select count(*)
    from public.organization_memberships
  ) <> 2 then
    raise exception
      'Unexpected organization_memberships set; expected exactly the two verified memberships. Review before continuing.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships
    where id = 'd930f71a-4a50-4416-8fd5-0e576fd0190e'
  ) then
    raise exception
      'Expected Ogemaw organization membership is missing; review before continuing.';
  end if;

  if not exists (
    select 1
    from public.organization_memberships
    where id = 'c35d9d4c-c140-4adf-874f-da69030e26ce'
  ) then
    raise exception
      'Expected Test School organization membership is missing; review before continuing.';
  end if;
end;
$$;

-- Explicit backfill of the two confirmed production memberships, targeted
-- by id - not inferred from local_data_migrated_at. Every other row
-- (none should exist, per the preflight above) would be left NULL here.

-- Ogemaw Heights High School - genuine legacy Falcon Deck account that
-- already completed its real migration (local_data_migrated_at is
-- non-null).
update public.organization_memberships
set account_origin = 'legacy_import'
where id = 'd930f71a-4a50-4416-8fd5-0e576fd0190e';

-- Test School - genuine brand-new cloud-era test account
-- (local_data_migrated_at is null).
update public.organization_memberships
set account_origin = 'cloud_native'
where id = 'c35d9d4c-c140-4adf-874f-da69030e26ce';

-- Defense-in-depth: fail if any row is still unclassified after the two
-- UPDATEs above, even though the preflight already proved the table's
-- exact membership. Never falls back to inferring account_origin from
-- local_data_migrated_at.
do $$
begin
  if exists (
    select 1 from public.organization_memberships where account_origin is null
  ) then
    raise exception 'Unclassified organization_memberships exist; review account_origin before continuing.';
  end if;
end;
$$;

-- Only after both checks pass does NOT NULL become safe to add.
alter table public.organization_memberships
  alter column account_origin set not null;

-- This default is for FUTURE memberships only - a backstop, not the
-- primary mechanism (Stage C wires bootstrap_organization to set
-- account_origin explicitly on every insert regardless). Deliberately
-- added last, only after both checks above already proved every existing
-- row was classified by name, so it can never participate in classifying
-- a row that existed before this migration ran.
alter table public.organization_memberships
  alter column account_origin set default 'cloud_native';

-- local_data_migrated_at is untouched by this migration - no row's value
-- changes, and no row's account_origin was derived from it.
