-- Falcon Deck V2 - join-existing-school feature, Stage A (schema only).
-- Per the corrected architecture plan (private-beta scope; admin
-- governance, join-approval, and per-teacher schedule-privacy policy stay
-- deferred). This migration adds no function, no RLS policy, and no
-- backfill/seed data - it is schema-only, exactly as scoped.
--
-- Three changes:
--   (A) organizations.city / organizations.state - nullable, no format
--       CHECK, so a hand-entered private-beta school is never blocked.
--   (B) teacher_schedule_preferences.active_bell_schedule_id - nullable,
--       with a composite FK to bell_schedules(organization_id, id) so a
--       teacher's preference can never point at another organization's
--       schedule. The organization-vs-teacher ownership disjunction (a
--       shared schedule must belong to this org; a private schedule must
--       belong to this same teacher) is a disjunction a composite FK can't
--       express - same tradeoff already accepted for class_sections.course_id
--       and lessons.course_id (V2_DATABASE_SCHEMA.md §8) - and stays an
--       application/RLS-layer check, added in a later stage, not here.
--   (C) bell_schedules gets a partial unique index guaranteeing at most one
--       owner_type='organization', is_default=true row per organization -
--       closing the ambiguity an organization-level default-schedule
--       pointer would otherwise exist to resolve (see architecture review).
--
-- Every assumption this migration depends on is checked explicitly below,
-- before the corresponding DDL, so an unexpected live-schema difference
-- fails loudly with a clear message rather than partially applying -
-- same preflight-assertion shape already used in
-- 20260922000000_organization_memberships_account_origin.sql.

-- Preflight (1): none of the three new columns already exist. ADD COLUMN
-- would fail on its own if one did, but with Postgres's generic "column
-- already exists" error rather than a message naming which assumption in
-- this migration broke.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'city'
  ) then
    raise exception 'organizations.city already exists; review before continuing.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'state'
  ) then
    raise exception 'organizations.state already exists; review before continuing.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teacher_schedule_preferences'
      and column_name = 'active_bell_schedule_id'
  ) then
    raise exception 'teacher_schedule_preferences.active_bell_schedule_id already exists; review before continuing.';
  end if;
end;
$$;

-- Preflight (2): bell_schedules has a UNIQUE constraint covering exactly
-- (organization_id, id) - required for the composite FK added below to be
-- creatable at all. Column order in the comparison is normalized
-- (alphabetical) so this matches regardless of how the constraint's
-- columns were originally declared.
do $$
declare
  v_found boolean;
begin
  select exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.constraint_schema = tc.constraint_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'bell_schedules'
      and tc.constraint_type = 'UNIQUE'
    group by tc.constraint_name
    having array_agg(kcu.column_name::text order by kcu.column_name::text)
      = array['id', 'organization_id']::text[]
  ) into v_found;

  if not v_found then
    raise exception 'bell_schedules has no usable UNIQUE constraint on (organization_id, id); review before continuing.';
  end if;
end;
$$;

-- Preflight (3): no organization currently has more than one
-- owner_type='organization', is_default=true bell schedule - the partial
-- unique index below would otherwise fail to create against real
-- conflicting data, and this names which invariant broke instead of
-- surfacing a raw duplicate-key error.
do $$
begin
  if exists (
    select 1
    from public.bell_schedules
    where owner_type = 'organization' and is_default
    group by organization_id
    having count(*) > 1
  ) then
    raise exception 'At least one organization already has more than one owner_type=organization, is_default=true bell schedule; resolve before adding the partial unique index.';
  end if;
end;
$$;

-- (A) organizations.city / organizations.state.
alter table public.organizations
  add column city text,
  add column state text;

-- (B) teacher_schedule_preferences.active_bell_schedule_id + composite FK.
alter table public.teacher_schedule_preferences
  add column active_bell_schedule_id text;

alter table public.teacher_schedule_preferences
  add constraint active_bell_schedule_id_same_org_fkey
    foreign key (organization_id, active_bell_schedule_id)
    references public.bell_schedules (organization_id, id);

-- (C) bell_schedules: at most one organization-owned default per organization.
create unique index bell_schedules_one_org_default
  on public.bell_schedules (organization_id)
  where owner_type = 'organization' and is_default;
