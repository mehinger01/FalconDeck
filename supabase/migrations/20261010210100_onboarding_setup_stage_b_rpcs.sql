-- Falcon Deck streamlined onboarding - Stage B (functions only).
-- Depends on Stage A (20261010210000_onboarding_setup_stage_a_schema.sql).
-- See docs/ONBOARDING_SETUP_ARCHITECTURE.md.
--
-- Three callable entry points, all SECURITY DEFINER, all `authenticated`
-- only, all taking the same identity posture as import_bell_schedule:
-- auth.uid() is the only trusted identity input, and the caller's
-- membership is resolved here from (auth.uid(), p_organization_id) - a
-- membership id is never accepted as a parameter.
--
--   get_setup_state(p_organization_id)
--   save_setup_draft(p_organization_id, p_expected_revision, p_payload)
--   complete_setup(p_organization_id, p_operation_id, p_expected_revision)
--
-- RESULT CONVENTION: every expected outcome - including a conflict - is
-- RETURNED as jsonb with a "status" key, never raised. Exceptions are
-- reserved for requests that are wrong in themselves (not signed in, no
-- membership, a payload that fails validation) and for genuine failures
-- while writing. Because a function body cannot partially commit, any
-- exception raised anywhere in complete_setup() rolls back every row it
-- had already written.
--
-- SERIALIZATION: save_setup_draft and complete_setup take the same
-- per-membership advisory transaction lock before reading anything, so two
-- overlapping calls for one membership (two tabs, a double-click, a retry
-- racing its original) run strictly one after the other, and - under
-- READ COMMITTED, Postgres's and PostgREST's default - the second always
-- sees the first's committed result. Three constraints stand behind the
-- lock and hold even without it: setup_drafts' primary key (one draft per
-- membership), setup_completions' primary key (one row per operation), and
-- its UNIQUE (owner_membership_id) (one completion per membership). A
-- caller on a stale REPEATABLE READ snapshot therefore fails with a unique
-- or serialization error instead of committing twice. See
-- scripts/verify-onboarding-setup-concurrency.ts.
--
-- What complete_setup() never does: it never writes bell_schedules,
-- schedule_blocks, or schedule_block_overrides rows for an
-- organization-owned schedule (a shared schedule gets
-- teacher_period_assignments rows only), never writes an
-- organization-owned course, never accepts owner/organization values from
-- the payload, and never deletes or updates an existing operational row
-- other than the caller's own teacher_schedule_preferences row.

-- ---------------------------------------------------------------------------
-- Private helpers - not executable by anon/authenticated; called only from
-- the SECURITY DEFINER functions below, which run as the owning role.
-- ---------------------------------------------------------------------------

create function public.setup_caller_membership(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select m.id into v_membership_id
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if v_membership_id is null then
    raise exception 'You do not have an active membership in this organization.' using errcode = '42501';
  end if;

  return v_membership_id;
end;
$$;

-- NULL means eligible. Guided setup is a new-account entry point only.
--
-- ESTABLISHED (ineligible, keeps the existing screens): a membership that
-- has or had legacy local data, or that owns any class section or any
-- bell schedule of its own - i.e. it has built something in the existing
-- app.
--
-- INTERRUPTED (still eligible): a cloud-native membership that got no
-- further than choosing which schedule to follow on /setup/schedule. Its
-- only footprint is a teacher_schedule_preferences row; with no schedule of
-- its own, that row can only name an organization-owned schedule.
-- get_setup_state() hands that choice back as `seed` so guided setup starts
-- from it instead of asking again, and complete_setup() upserts the same
-- row.
create function public.setup_ineligibility_reason(p_membership_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_account_origin text;
  v_migrated_at timestamptz;
begin
  select m.account_origin, m.local_data_migrated_at
  into v_account_origin, v_migrated_at
  from public.organization_memberships m
  where m.id = p_membership_id;

  if v_account_origin = 'legacy_import' then
    return case when v_migrated_at is null then 'migration-pending' else 'legacy-account' end;
  end if;

  if exists (select 1 from public.class_sections s where s.owner_membership_id = p_membership_id)
    or exists (select 1 from public.bell_schedules b where b.owner_membership_id = p_membership_id)
  then
    return 'existing-setup';
  end if;

  return null;
end;
$$;

-- Same escaping as lib/data/scopedCloudId.ts's scopedCloudId(parentId,
-- localId) and import_bell_schedule: backslash first, then colon, per
-- component, joined with one literal ":".
create function public.setup_scoped_id(p_parent_id text, p_local_id text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select replace(replace(p_parent_id, '\', '\\'), ':', '\:')
    || ':' || replace(replace(p_local_id, '\', '\\'), ':', '\:');
$$;

-- Same collapse as lib/data/supabaseMapping.ts's normalizeDbTime: "HH:mm"
-- when the seconds component is exactly zero, "HH:mm:ss" otherwise.
create function public.setup_time_text(p_time time)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when extract(second from p_time) = 0 then to_char(p_time, 'HH24:MI')
    else to_char(p_time, 'HH24:MI:SS')
  end;
$$;

create function public.setup_draft_json(p_draft public.setup_drafts, p_include_payload boolean)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'operationId', p_draft.operation_id,
    'revision', p_draft.revision,
    'updatedAt', p_draft.updated_at
  ) || case when p_include_payload then jsonb_build_object('payload', p_draft.payload) else '{}'::jsonb end;
$$;

revoke execute on function public.setup_caller_membership(uuid) from public, anon, authenticated;
revoke execute on function public.setup_ineligibility_reason(uuid) from public, anon, authenticated;
revoke execute on function public.setup_scoped_id(text, text) from public, anon, authenticated;
revoke execute on function public.setup_time_text(time) from public, anon, authenticated;
revoke execute on function public.setup_draft_json(public.setup_drafts, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_setup_state - read only.
--   { status: 'completed',   completion }
--   { status: 'in-progress', draft: { operationId, revision, updatedAt, payload } }
--   { status: 'not-started', eligible, reason, seed: { activeBellScheduleId, lunchWave } }
-- `seed` is what the membership already chose in the existing setup
-- screens (null / 'none' for a brand-new account).
-- ---------------------------------------------------------------------------

create function public.get_setup_state(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_membership_id uuid := public.setup_caller_membership(p_organization_id);
  v_completion jsonb;
  v_draft public.setup_drafts;
  v_reason text;
  v_active_schedule_id text;
  v_lunch_wave text;
begin
  select c.result into v_completion
  from public.setup_completions c
  where c.owner_membership_id = v_membership_id;
  if found then
    return jsonb_build_object('status', 'completed', 'completion', v_completion);
  end if;

  select d.* into v_draft
  from public.setup_drafts d
  where d.owner_membership_id = v_membership_id;
  if found then
    return jsonb_build_object('status', 'in-progress', 'draft', public.setup_draft_json(v_draft, true));
  end if;

  v_reason := public.setup_ineligibility_reason(v_membership_id);

  select p.active_bell_schedule_id, p.lunch_wave into v_active_schedule_id, v_lunch_wave
  from public.teacher_schedule_preferences p
  where p.owner_membership_id = v_membership_id;

  return jsonb_build_object(
    'status', 'not-started',
    'eligible', v_reason is null,
    'reason', v_reason,
    'seed', jsonb_build_object(
      'activeBellScheduleId', v_active_schedule_id,
      'lunchWave', coalesce(v_lunch_wave, 'none')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- save_setup_draft - create (p_expected_revision NULL) or revise a draft.
--   { status: 'saved',      draft: { operationId, revision, updatedAt } }
--   { status: 'conflict',   reason: 'draft-exists' | 'stale-revision', draft: {... payload} }
--   { status: 'conflict',   reason: 'draft-missing' }
--   { status: 'completed',  completion }
--   { status: 'ineligible', reason }
-- The payload is stored as given: a draft is allowed to be incomplete, so
-- content is validated only by complete_setup(). Only its type and size are
-- checked here.
-- ---------------------------------------------------------------------------

create function public.save_setup_draft(
  p_organization_id uuid,
  p_expected_revision integer,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_membership_id uuid := public.setup_caller_membership(p_organization_id);
  v_completion jsonb;
  v_draft public.setup_drafts;
  v_reason text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Setup draft must be a JSON object.' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 262144 then
    raise exception 'Setup draft is too large.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('onboarding_setup:' || v_membership_id::text, 0));

  select c.result into v_completion
  from public.setup_completions c
  where c.owner_membership_id = v_membership_id;
  if found then
    return jsonb_build_object('status', 'completed', 'completion', v_completion);
  end if;

  select d.* into v_draft
  from public.setup_drafts d
  where d.owner_membership_id = v_membership_id;

  if p_expected_revision is null then
    if found then
      return jsonb_build_object(
        'status', 'conflict', 'reason', 'draft-exists', 'draft', public.setup_draft_json(v_draft, true));
    end if;

    v_reason := public.setup_ineligibility_reason(v_membership_id);
    if v_reason is not null then
      return jsonb_build_object('status', 'ineligible', 'reason', v_reason);
    end if;

    insert into public.setup_drafts (owner_membership_id, organization_id, payload)
    values (v_membership_id, p_organization_id, p_payload)
    returning * into v_draft;

    return jsonb_build_object('status', 'saved', 'draft', public.setup_draft_json(v_draft, false));
  end if;

  if not found then
    return jsonb_build_object('status', 'conflict', 'reason', 'draft-missing');
  end if;

  if v_draft.revision <> p_expected_revision then
    return jsonb_build_object(
      'status', 'conflict', 'reason', 'stale-revision', 'draft', public.setup_draft_json(v_draft, true));
  end if;

  -- The revision is re-stated in the WHERE clause, so the compare-and-swap
  -- is a single statement in its own right and does not depend on the
  -- advisory lock above having been taken. With the lock it always matches.
  update public.setup_drafts d
  set payload = p_payload,
      revision = d.revision + 1,
      updated_at = now()
  where d.owner_membership_id = v_membership_id
    and d.revision = p_expected_revision
  returning * into v_draft;

  if not found then
    select d.* into v_draft
    from public.setup_drafts d
    where d.owner_membership_id = v_membership_id;
    return jsonb_build_object(
      'status', 'conflict', 'reason', 'stale-revision', 'draft', public.setup_draft_json(v_draft, true));
  end if;

  return jsonb_build_object('status', 'saved', 'draft', public.setup_draft_json(v_draft, false));
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_setup - commits the STORED draft (the payload is read from
-- setup_drafts, never accepted from the caller) in one transaction.
--   { status: 'completed', replayed, completion }
--   { status: 'conflict',  reason: 'stale-revision' | 'operation-mismatch', draft }
--   { status: 'conflict',  reason: 'shared-schedule-changed' | 'draft-missing' }
--   { status: 'conflict',  reason: 'already-completed', completion }
-- ---------------------------------------------------------------------------

create function public.complete_setup(
  p_organization_id uuid,
  p_operation_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_membership_id uuid := public.setup_caller_membership(p_organization_id);
  v_completion jsonb;
  v_completion_owner uuid;
  v_draft public.setup_drafts;
  v_payload jsonb;
  v_courses jsonb;
  v_sections jsonb;
  v_schedule jsonb;
  v_mode text;
  v_schedule_id text;
  v_assignments jsonb;
  v_blocks jsonb;
  v_current_blocks jsonb;
  v_expected_blocks jsonb;
  v_lunch_wave text;
  v_lesson jsonb;
  v_lesson_id text;
  v_lesson_date date;
  v_block jsonb;
  v_index integer := 0;
  v_start time;
  v_end time;
  v_prev_end time;
  v_prev_label text;
  v_sorted_label text;
  v_sorted_start time;
  v_sorted_end time;
  v_result jsonb;
begin
  if p_operation_id is null then
    raise exception 'Operation id is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('onboarding_setup:' || v_membership_id::text, 0));

  -- (1) Idempotent replay. Checked after the lock, so a retry that raced
  -- its own original waits for it and then lands here.
  select c.result, c.owner_membership_id into v_completion, v_completion_owner
  from public.setup_completions c
  where c.operation_id = p_operation_id;
  if found then
    if v_completion_owner <> v_membership_id then
      raise exception 'Setup operation not found.' using errcode = '42501';
    end if;
    return jsonb_build_object('status', 'completed', 'replayed', true, 'completion', v_completion);
  end if;

  select c.result into v_completion
  from public.setup_completions c
  where c.owner_membership_id = v_membership_id;
  if found then
    return jsonb_build_object('status', 'conflict', 'reason', 'already-completed', 'completion', v_completion);
  end if;

  -- (2) The draft this call claims to be completing.
  select d.* into v_draft
  from public.setup_drafts d
  where d.owner_membership_id = v_membership_id;
  if not found then
    return jsonb_build_object('status', 'conflict', 'reason', 'draft-missing');
  end if;
  if v_draft.operation_id <> p_operation_id then
    return jsonb_build_object(
      'status', 'conflict', 'reason', 'operation-mismatch', 'draft', public.setup_draft_json(v_draft, true));
  end if;
  if p_expected_revision is null or v_draft.revision <> p_expected_revision then
    return jsonb_build_object(
      'status', 'conflict', 'reason', 'stale-revision', 'draft', public.setup_draft_json(v_draft, true));
  end if;

  v_payload := v_draft.payload;
  if coalesce(v_payload ->> 'version', '') <> '1' then
    raise exception 'This setup draft was saved by a different version of Falcon Deck.' using errcode = '22023';
  end if;

  -- (3) Courses the teacher is creating. May be empty when every class
  -- uses an existing course.
  v_courses := coalesce(v_payload -> 'courses', '[]'::jsonb);
  if jsonb_typeof(v_courses) <> 'array' then
    raise exception 'Setup draft courses are malformed.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_courses) c
    where coalesce(btrim(c ->> 'id'), '') = ''
      or coalesce(btrim(c ->> 'name'), '') = ''
      or length(c ->> 'name') > 200
  ) then
    raise exception 'Every course needs a name.' using errcode = '22023';
  end if;
  if (select count(distinct c ->> 'id') from jsonb_array_elements(v_courses) c) <> jsonb_array_length(v_courses) then
    raise exception 'Duplicate course in setup draft.' using errcode = '22023';
  end if;

  -- (4) Class sections. Each must name a course the caller may use: one
  -- created by this same draft, an organization catalog course, or one of
  -- the caller's own courses - the disjunction V2_DATABASE_SCHEMA.md 2.9
  -- leaves to the write path.
  v_sections := coalesce(v_payload -> 'classSections', '[]'::jsonb);
  if jsonb_typeof(v_sections) <> 'array' or jsonb_array_length(v_sections) = 0 then
    raise exception 'Add at least one class.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_sections) s
    where coalesce(btrim(s ->> 'id'), '') = ''
      or coalesce(btrim(s ->> 'name'), '') = ''
      or length(s ->> 'name') > 200
  ) then
    raise exception 'Every class needs a name.' using errcode = '22023';
  end if;
  if (select count(distinct s ->> 'id') from jsonb_array_elements(v_sections) s) <> jsonb_array_length(v_sections) then
    raise exception 'Duplicate class in setup draft.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_sections) s
    where not exists (select 1 from jsonb_array_elements(v_courses) c where c ->> 'id' = s ->> 'courseId')
      and not exists (
        select 1 from public.courses c
        where c.id = s ->> 'courseId'
          and c.organization_id = p_organization_id
          and (c.owner_type = 'organization' or c.owner_membership_id = v_membership_id)
      )
  ) then
    raise exception 'A class refers to a course that is not available.' using errcode = '22023';
  end if;

  -- (5) Schedule.
  v_schedule := v_payload -> 'schedule';
  if v_schedule is null or jsonb_typeof(v_schedule) <> 'object' then
    raise exception 'Choose a schedule before finishing setup.' using errcode = '22023';
  end if;
  v_mode := v_schedule ->> 'mode';

  if v_mode = 'shared' then
    v_schedule_id := v_schedule ->> 'scheduleId';

    -- (5a) The shared schedule must still be exactly what the teacher was
    -- shown: same blocks, same order, same times/labels/kinds, and the same
    -- weekday overrides on each block (a period that moves or is renamed
    -- only on Wednesdays is still a change to the teacher's day). Anything
    -- else (edited, emptied, deleted, no longer shared) is reported as a
    -- conflict so the teacher reviews the new periods - never silently
    -- committed against a schedule they did not see. Overrides are
    -- compared as a set per block: both sides are ordered by weekday here,
    -- so the order they were stored or sent in is irrelevant.
    if not exists (
      select 1 from public.bell_schedules b
      where b.id = v_schedule_id
        and b.organization_id = p_organization_id
        and b.owner_type = 'organization'
        and not b.needs_configuration
    ) then
      return jsonb_build_object('status', 'conflict', 'reason', 'shared-schedule-changed');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', sb.id,
      'label', sb.label,
      'kind', sb.kind,
      'startTime', public.setup_time_text(sb.start_time),
      'endTime', public.setup_time_text(sb.end_time),
      'overrides', coalesce((
        select jsonb_agg(jsonb_build_object(
          'weekday', o.weekday,
          'label', o.label,
          'kind', o.kind,
          'startTime', public.setup_time_text(o.start_time),
          'endTime', public.setup_time_text(o.end_time)
        ) order by o.weekday)
        from public.schedule_block_overrides o
        where o.schedule_block_id = sb.id
      ), '[]'::jsonb)
    ) order by sb.position), '[]'::jsonb)
    into v_current_blocks
    from public.schedule_blocks sb
    where sb.bell_schedule_id = v_schedule_id;

    if jsonb_typeof(coalesce(v_schedule -> 'expectedBlocks', '[]'::jsonb)) <> 'array' then
      raise exception 'Setup draft schedule is malformed.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', public.setup_scoped_id(v_schedule_id, e.value ->> 'id'),
      'label', e.value ->> 'label',
      'kind', e.value ->> 'kind',
      'startTime', e.value ->> 'startTime',
      'endTime', e.value ->> 'endTime',
      'overrides', coalesce((
        select jsonb_agg(jsonb_build_object(
          'weekday', o.value ->> 'weekday',
          'label', o.value ->> 'label',
          'kind', o.value ->> 'kind',
          'startTime', o.value ->> 'startTime',
          'endTime', o.value ->> 'endTime'
        ) order by o.value ->> 'weekday')
        from jsonb_array_elements(
          case when jsonb_typeof(e.value -> 'overrides') = 'array' then e.value -> 'overrides' else '[]'::jsonb end
        ) o
      ), '[]'::jsonb)
    ) order by e.ordinality), '[]'::jsonb)
    into v_expected_blocks
    from jsonb_array_elements(coalesce(v_schedule -> 'expectedBlocks', '[]'::jsonb)) with ordinality e;

    if v_current_blocks <> v_expected_blocks then
      return jsonb_build_object('status', 'conflict', 'reason', 'shared-schedule-changed');
    end if;

    -- (5b) The teacher's own period assignments onto that schedule.
    v_assignments := coalesce(v_schedule -> 'assignments', '[]'::jsonb);
    if jsonb_typeof(v_assignments) <> 'array' or jsonb_array_length(v_assignments) = 0 then
      raise exception 'Assign at least one class to a period.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_assignments) a
      where coalesce(a ->> 'id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    ) then
      raise exception 'Setup draft period assignments are malformed.' using errcode = '22023';
    end if;
    if (select count(distinct a ->> 'blockId') from jsonb_array_elements(v_assignments) a) <> jsonb_array_length(v_assignments)
      or (select count(distinct lower(a ->> 'id')) from jsonb_array_elements(v_assignments) a) <> jsonb_array_length(v_assignments)
    then
      raise exception 'A period is assigned more than once.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_assignments) a
      where not exists (
        select 1 from public.schedule_blocks sb
        where sb.bell_schedule_id = v_schedule_id
          and sb.id = public.setup_scoped_id(v_schedule_id, a ->> 'blockId')
      )
    ) then
      raise exception 'A class is assigned to a period that is not on this schedule.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_assignments) a
      where not exists (select 1 from jsonb_array_elements(v_sections) s where s ->> 'id' = a ->> 'classSectionId')
    ) then
      raise exception 'A period is assigned to a class that is not in this setup.' using errcode = '22023';
    end if;

  elsif v_mode = 'own' then
    -- (5c) A private schedule within this organization. Same per-block and
    -- whole-schedule rules as import_bell_schedule; 'custom' blocks are
    -- additionally allowed, as they are in Schedule Setup.
    v_schedule_id := v_schedule ->> 'id';
    if coalesce(btrim(v_schedule_id), '') = '' then
      raise exception 'Schedule id is required.' using errcode = '22023';
    end if;
    if coalesce(btrim(v_schedule ->> 'name'), '') = '' then
      raise exception 'Schedule name is required.' using errcode = '22023';
    end if;
    if length(v_schedule ->> 'name') > 200 then
      raise exception 'Schedule name is too long.' using errcode = '22023';
    end if;

    v_blocks := coalesce(v_schedule -> 'blocks', '[]'::jsonb);
    if jsonb_typeof(v_blocks) <> 'array' or jsonb_array_length(v_blocks) = 0 then
      raise exception 'At least one schedule block is required.' using errcode = '22023';
    end if;
    if (select count(distinct b ->> 'id') from jsonb_array_elements(v_blocks) b) <> jsonb_array_length(v_blocks) then
      raise exception 'Duplicate block id in setup draft.' using errcode = '22023';
    end if;

    for v_block in select value from jsonb_array_elements(v_blocks)
    loop
      v_index := v_index + 1;
      if coalesce(btrim(v_block ->> 'id'), '') = '' then
        raise exception 'Block % is missing an id.', v_index using errcode = '22023';
      end if;
      if coalesce(btrim(v_block ->> 'label'), '') = '' then
        raise exception 'Block % is missing a name.', v_index using errcode = '22023';
      end if;
      if length(v_block ->> 'label') > 200 then
        raise exception 'Block % name is too long.', v_index using errcode = '22023';
      end if;
      if coalesce(v_block ->> 'kind', '') not in ('instructional', 'enrichment', 'prep', 'lunch', 'passing', 'custom') then
        raise exception 'Block % has an unrecognized type.', v_index using errcode = '22023';
      end if;
      begin
        v_start := (v_block ->> 'startTime')::time;
        v_end := (v_block ->> 'endTime')::time;
      exception when others then
        raise exception 'Block % has an invalid start or end time.', v_index using errcode = '22023';
      end;
      if v_start is null or v_end is null then
        raise exception 'Block % has an invalid start or end time.', v_index using errcode = '22023';
      end if;
      if v_end <= v_start then
        raise exception 'Block % ends at or before it starts.', v_index using errcode = '22023';
      end if;
      if v_block ->> 'classSectionId' is not null and not exists (
        select 1 from jsonb_array_elements(v_sections) s where s ->> 'id' = v_block ->> 'classSectionId'
      ) then
        raise exception 'Block % is assigned to a class that is not in this setup.', v_index using errcode = '22023';
      end if;
    end loop;

    if not exists (select 1 from jsonb_array_elements(v_blocks) b where b ->> 'classSectionId' is not null) then
      raise exception 'Assign at least one class to a period.' using errcode = '22023';
    end if;

    v_prev_end := null;
    for v_sorted_label, v_sorted_start, v_sorted_end in
      select value ->> 'label', (value ->> 'startTime')::time, (value ->> 'endTime')::time
      from jsonb_array_elements(v_blocks)
      order by (value ->> 'startTime')::time
    loop
      if v_prev_end is not null and v_prev_end > v_sorted_start then
        raise exception 'Block "%" overlaps with "%".', v_prev_label, v_sorted_label using errcode = '22023';
      end if;
      v_prev_end := v_sorted_end;
      v_prev_label := v_sorted_label;
    end loop;

  else
    raise exception 'Choose a schedule before finishing setup.' using errcode = '22023';
  end if;

  -- (6) Preferences.
  v_lunch_wave := coalesce(v_payload ->> 'lunchWave', 'none');
  if v_lunch_wave not in ('A', 'B', 'C', 'none') then
    raise exception 'Unrecognized lunch wave.' using errcode = '22023';
  end if;

  -- (7) First lesson - required, and required to be "prepared" by the same
  -- definition lib/week/getLessonPlanningStatus.ts uses everywhere else: a
  -- non-blank learning target, or at least one agenda item, resource, or
  -- announcement. lib/onboarding/setupDraft.ts's validateSetupDraft states
  -- the identical rule for the client; this is the enforcement.
  v_lesson := v_payload -> 'firstLesson';
  if v_lesson is null or jsonb_typeof(v_lesson) <> 'object' then
    raise exception 'Plan a first lesson before finishing setup.' using errcode = '22023';
  end if;
  v_lesson_id := v_lesson ->> 'id';
  if coalesce(btrim(v_lesson_id), '') = '' then
    raise exception 'Setup draft lesson is malformed.' using errcode = '22023';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_sections) s where s ->> 'id' = v_lesson ->> 'classSectionId') then
    raise exception 'The first lesson is for a class that is not in this setup.' using errcode = '22023';
  end if;
  begin
    v_lesson_date := (v_lesson ->> 'date')::date;
  exception when others then
    raise exception 'The first lesson has an invalid date.' using errcode = '22023';
  end;
  if v_lesson_date is null then
    raise exception 'The first lesson has an invalid date.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(v_lesson -> 'agendaItems', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(v_lesson -> 'resources', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(v_lesson -> 'announcements', '[]'::jsonb)) <> 'array'
  then
    raise exception 'Setup draft lesson is malformed.' using errcode = '22023';
  end if;
  if coalesce(v_lesson ->> 'learningTarget', '') !~ '[^[:space:]]'
    and jsonb_array_length(coalesce(v_lesson -> 'agendaItems', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_lesson -> 'resources', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(v_lesson -> 'announcements', '[]'::jsonb)) = 0
  then
    raise exception 'Add a learning target or an agenda item to your first lesson.' using errcode = '22023';
  end if;

  -- (8) Writes - parent before child. Every owner/organization value below
  -- is p_organization_id or the membership resolved above, never a payload
  -- value.
  insert into public.courses (id, organization_id, owner_type, owner_membership_id, name, color_hex, description)
  select c ->> 'id', p_organization_id, 'teacher', v_membership_id, btrim(c ->> 'name'), c ->> 'colorHex', c ->> 'description'
  from jsonb_array_elements(v_courses) c;

  insert into public.class_sections (id, organization_id, owner_membership_id, course_id, name, room)
  select s ->> 'id', p_organization_id, v_membership_id, s ->> 'courseId', btrim(s ->> 'name'), s ->> 'room'
  from jsonb_array_elements(v_sections) s;

  if v_mode = 'own' then
    insert into public.bell_schedules (
      id, organization_id, owner_type, owner_membership_id, profile_key,
      name, description, time_zone, is_default, source, needs_configuration
    )
    values (
      v_schedule_id, p_organization_id, 'teacher', v_membership_id, null,
      btrim(v_schedule ->> 'name'), null, coalesce(v_schedule ->> 'timeZone', 'America/Detroit'), false, 'custom', false
    );

    -- position comes from chronological order, never payload order - same
    -- rule as import_bell_schedule.
    insert into public.schedule_blocks (
      id, bell_schedule_id, organization_id, owner_type, owner_membership_id,
      position, label, kind, custom_kind_label, start_time, end_time,
      class_section_id, is_lunch_window
    )
    select
      public.setup_scoped_id(v_schedule_id, ordered.value ->> 'id'),
      v_schedule_id,
      p_organization_id,
      'teacher',
      v_membership_id,
      ordered.chronological_position,
      btrim(ordered.value ->> 'label'),
      ordered.value ->> 'kind',
      ordered.value ->> 'customKindLabel',
      (ordered.value ->> 'startTime')::time,
      (ordered.value ->> 'endTime')::time,
      ordered.value ->> 'classSectionId',
      false
    from (
      select
        value,
        (row_number() over (order by (value ->> 'startTime')::time, value ->> 'id') - 1)::integer as chronological_position
      from jsonb_array_elements(v_blocks)
    ) as ordered;
  else
    -- Shared schedule: teacher-specific assignments only. Base rows
    -- (override_weekday NULL) - the same shape Schedule Setup writes.
    insert into public.teacher_period_assignments (
      id, organization_id, owner_membership_id, schedule_block_id, override_weekday, class_section_id
    )
    select
      (a ->> 'id')::uuid,
      p_organization_id,
      v_membership_id,
      public.setup_scoped_id(v_schedule_id, a ->> 'blockId'),
      null,
      a ->> 'classSectionId'
    from jsonb_array_elements(v_assignments) a;
  end if;

  insert into public.teacher_schedule_preferences (
    owner_membership_id, organization_id, lunch_wave, active_bell_schedule_id
  )
  values (v_membership_id, p_organization_id, v_lunch_wave, v_schedule_id)
  on conflict (owner_membership_id) do update
  set lunch_wave = excluded.lunch_wave,
      active_bell_schedule_id = excluded.active_bell_schedule_id,
      updated_at = now();

  insert into public.lessons (
    id, organization_id, owner_membership_id, course_id, lesson_date,
    learning_target, agenda_items, resources, announcements, materials, warmup
  )
  select
    v_lesson_id,
    p_organization_id,
    v_membership_id,
    s ->> 'courseId',
    v_lesson_date,
    coalesce(v_lesson ->> 'learningTarget', ''),
    coalesce(v_lesson -> 'agendaItems', '[]'::jsonb),
    coalesce(v_lesson -> 'resources', '[]'::jsonb),
    coalesce(v_lesson -> 'announcements', '[]'::jsonb),
    v_lesson ->> 'materials',
    v_lesson ->> 'warmup'
  from jsonb_array_elements(v_sections) s
  where s ->> 'id' = v_lesson ->> 'classSectionId';

  insert into public.lesson_class_sections (
    lesson_id, class_section_id, organization_id, owner_membership_id, lesson_date
  )
  values (v_lesson_id, v_lesson ->> 'classSectionId', p_organization_id, v_membership_id, v_lesson_date);

  -- (9) Record the outcome and retire the draft, in this same transaction:
  -- the draft exists exactly as long as the completion has not committed.
  v_result := jsonb_build_object(
    'operationId', p_operation_id,
    'completedAt', now(),
    'scheduleMode', v_mode,
    'activeBellScheduleId', v_schedule_id,
    'courseIds', (select coalesce(jsonb_agg(c ->> 'id'), '[]'::jsonb) from jsonb_array_elements(v_courses) c),
    'classSectionIds', (select coalesce(jsonb_agg(s ->> 'id'), '[]'::jsonb) from jsonb_array_elements(v_sections) s),
    'lessonId', v_lesson_id
  );

  insert into public.setup_completions (operation_id, owner_membership_id, organization_id, result)
  values (p_operation_id, v_membership_id, p_organization_id, v_result);

  delete from public.setup_drafts d where d.owner_membership_id = v_membership_id;

  return jsonb_build_object('status', 'completed', 'replayed', false, 'completion', v_result);
end;
$$;

comment on function public.get_setup_state(uuid) is
  'Guided setup: read-only state for the caller''s membership in p_organization_id - completed (with the stored result), in-progress (with the draft), or not-started (with eligibility).';
comment on function public.save_setup_draft(uuid, integer, jsonb) is
  'Guided setup: creates (p_expected_revision NULL) or revises the caller''s draft. A revision mismatch is returned as a conflict carrying the current draft, never applied.';
comment on function public.complete_setup(uuid, uuid, integer) is
  'Guided setup: atomically commits the caller''s STORED draft - teacher-owned courses, class sections, either a private schedule with its blocks or teacher_period_assignments onto a shared schedule, schedule preferences, and a prepared first lesson - then records the result and deletes the draft. Idempotent on p_operation_id: a retry of a committed operation returns the stored result and writes nothing. Never writes organization-owned rows.';

revoke execute on function public.get_setup_state(uuid) from public;
revoke execute on function public.get_setup_state(uuid) from anon;
grant execute on function public.get_setup_state(uuid) to authenticated;

revoke execute on function public.save_setup_draft(uuid, integer, jsonb) from public;
revoke execute on function public.save_setup_draft(uuid, integer, jsonb) from anon;
grant execute on function public.save_setup_draft(uuid, integer, jsonb) to authenticated;

revoke execute on function public.complete_setup(uuid, uuid, integer) from public;
revoke execute on function public.complete_setup(uuid, uuid, integer) from anon;
grant execute on function public.complete_setup(uuid, uuid, integer) to authenticated;
