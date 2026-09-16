-- Falcon Deck V2 - corrective migration (post-Stage-B).
--
-- Closes a real incompatibility discovered building the Supabase Data
-- Repository + Local Data Migration milestone: school_year_calendars was
-- organization-scoped only (no owner_type/owner_membership_id), so a
-- teacher's local Master Calendar had no valid destination during
-- migration - the only options were promoting it to canonical
-- organization data (explicitly rejected, see Decision 1 of that
-- milestone) or silently skipping it (explicitly rejected as a final
-- design). This migration extends the same dual-ownership pattern already
-- used by courses and bell_schedules (V2_DATABASE_SCHEMA.md §0.3) to
-- school_year_calendars, so a teacher-owned calendar is now a real,
-- first-class option - never a promotion of that teacher's data to
-- institutional truth.
--
-- No school_year_calendars rows exist on the live project today, so there
-- is nothing to backfill, but owner_type's DEFAULT 'organization' is
-- chosen specifically so this migration would still be safe to run against
-- a project that already had canonical calendar rows: every existing row
-- becomes owner_type='organization', owner_membership_id=null, which is
-- exactly its current (implicit) meaning and satisfies both new CHECK
-- constraints automatically.

alter table public.school_year_calendars
  add column owner_type text not null default 'organization'
    check (owner_type in ('organization', 'teacher')),
  add column owner_membership_id uuid references public.organization_memberships (id) on delete restrict;

alter table public.school_year_calendars
  add constraint school_year_calendars_owner_matches_type check (
    (owner_type = 'organization' and owner_membership_id is null) or
    (owner_type = 'teacher' and owner_membership_id is not null)
  );

-- Specific to this table (courses/bell_schedules have no is_canonical
-- concept): makes it a database-structural impossibility, not just a
-- convention, for a teacher-owned calendar to ever be canonical. The
-- existing school_year_calendars_one_canonical partial unique index
-- (organization_id, school_year) WHERE is_canonical is untouched - this
-- constraint is what keeps that index from ever needing to consider a
-- teacher-owned row in the first place.
alter table public.school_year_calendars
  add constraint school_year_calendars_canonical_only_organization check (
    not is_canonical or owner_type = 'organization'
  );

-- default_bell_schedule_id's composite FK (organization_id,
-- default_bell_schedule_id) -> bell_schedules(organization_id, id) is
-- unchanged - it verifies same-organization only, same as every other
-- owner_membership_id-adjacent FK in this schema (the accepted
-- "organization_id-vs-owner_membership_id consistency gap",
-- V2_DATABASE_SCHEMA.md §8). A teacher-owned calendar's default schedule
-- is expected to be that same teacher's own bell_schedules row.

drop policy "school_year_calendars_select" on public.school_year_calendars;
drop policy "school_year_calendars_insert" on public.school_year_calendars;
drop policy "school_year_calendars_update" on public.school_year_calendars;
drop policy "school_year_calendars_delete" on public.school_year_calendars;

-- Dual-owned policy shape, identical in structure to courses/bell_schedules
-- (V2_DATABASE_SCHEMA.md §2.5/§2.6). SELECT/DELETE stay ownership-based;
-- INSERT/UPDATE's WITH CHECK use app_owns_membership_in_org() so a write
-- can never attach a teacher-owned row's organization_id to a membership
-- from a different organization. No self-promotion path exists: the
-- organization branch of every write policy requires app_is_admin(), which
-- a non-admin teacher never satisfies.
create policy "school_year_calendars_select"
  on public.school_year_calendars for select
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_member(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );

create policy "school_year_calendars_insert"
  on public.school_year_calendars for insert
  to authenticated
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "school_year_calendars_update"
  on public.school_year_calendars for update
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  )
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "school_year_calendars_delete"
  on public.school_year_calendars for delete
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );

-- school_calendar_exceptions gets no new columns - per design, ownership is
-- inherited through the parent school_year_calendars row via a join rather
-- than denormalizing owner_type/owner_membership_id onto a fourth/fifth
-- table (this is a low-volume child table; the per-row join cost is
-- negligible next to the ceremony of two more columns and another CHECK
-- constraint). USING evaluates against the row's current (pre-update)
-- school_year_calendar_id/parent; WITH CHECK evaluates against the
-- resulting (post-update) one - Postgres binds each clause to the
-- appropriate row version automatically.

drop policy "school_calendar_exceptions_select" on public.school_calendar_exceptions;
drop policy "school_calendar_exceptions_insert" on public.school_calendar_exceptions;
drop policy "school_calendar_exceptions_update" on public.school_calendar_exceptions;
drop policy "school_calendar_exceptions_delete" on public.school_calendar_exceptions;

create policy "school_calendar_exceptions_select"
  on public.school_calendar_exceptions for select
  to authenticated
  using (
    exists (
      select 1 from public.school_year_calendars c
      where c.id = school_calendar_exceptions.school_year_calendar_id
        and (
          (c.owner_type = 'organization' and public.app_is_member(c.organization_id))
          or (c.owner_type = 'teacher' and public.app_owns_membership(c.owner_membership_id))
        )
    )
  );

create policy "school_calendar_exceptions_insert"
  on public.school_calendar_exceptions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.school_year_calendars c
      where c.id = school_calendar_exceptions.school_year_calendar_id
        and (
          (c.owner_type = 'organization' and public.app_is_admin(c.organization_id))
          or (c.owner_type = 'teacher' and public.app_owns_membership_in_org(c.owner_membership_id, c.organization_id))
        )
    )
  );

create policy "school_calendar_exceptions_update"
  on public.school_calendar_exceptions for update
  to authenticated
  using (
    exists (
      select 1 from public.school_year_calendars c
      where c.id = school_calendar_exceptions.school_year_calendar_id
        and (
          (c.owner_type = 'organization' and public.app_is_admin(c.organization_id))
          or (c.owner_type = 'teacher' and public.app_owns_membership(c.owner_membership_id))
        )
    )
  )
  with check (
    exists (
      select 1 from public.school_year_calendars c
      where c.id = school_calendar_exceptions.school_year_calendar_id
        and (
          (c.owner_type = 'organization' and public.app_is_admin(c.organization_id))
          or (c.owner_type = 'teacher' and public.app_owns_membership_in_org(c.owner_membership_id, c.organization_id))
        )
    )
  );

create policy "school_calendar_exceptions_delete"
  on public.school_calendar_exceptions for delete
  to authenticated
  using (
    exists (
      select 1 from public.school_year_calendars c
      where c.id = school_calendar_exceptions.school_year_calendar_id
        and (
          (c.owner_type = 'organization' and public.app_is_admin(c.organization_id))
          or (c.owner_type = 'teacher' and public.app_owns_membership(c.owner_membership_id))
        )
    )
  );
