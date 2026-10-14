-- Falcon Deck - ordinary schedule-preference writes through one function.
-- Part of the streamlined-onboarding work; see
-- docs/ONBOARDING_SETUP_ARCHITECTURE.md §8. Adds two functions and nothing
-- else: no table, policy, or grant on an existing object is altered.
--
-- WHY. complete_setup() (20261010210100) locks the caller's membership row
-- and only then reads and writes teacher_schedule_preferences. The ordinary
-- save path wrote that table directly and took no lock first, which left two
-- problems when the two overlapped:
--   * A first-row INSERT wrote the row and only then took a KEY SHARE lock
--     on the membership row for its foreign key - the opposite order to
--     complete_setup(), so the two could deadlock.
--   * An UPDATE that had waited for a completion re-ran the table's WITH
--     CHECK policy with the snapshot it started with. When the completion
--     had just created the private schedule the row now names, that policy
--     could not see it and rejected the UPDATE (42501).
--
-- PROTOCOL. save_teacher_schedule_preferences() first takes the caller's
-- membership row lock and only then touches the preferences row, in later
-- statements - each of which, under READ COMMITTED, runs with a new
-- snapshot taken after the lock was granted. The lock is FOR NO KEY UPDATE:
-- it conflicts with complete_setup()'s FOR UPDATE and with itself (so two
-- tabs' preference writes run one after the other), but not with the KEY
-- SHARE locks every ordinary insert of a class, course or schedule takes for
-- its foreign key, so those are not held up.
--
-- AUTHORIZATION is unchanged. save_teacher_schedule_preferences() is
-- SECURITY INVOKER: its UPDATE and INSERT run as the caller, under
-- teacher_schedule_preferences' existing RLS policies (own row, same
-- organization, and an active schedule the caller may use). Only the lock is
-- taken by a SECURITY DEFINER helper, because locking a row needs the right
-- to update it and organization_memberships' UPDATE policy is admin-only -
-- as the caller, an ordinary teacher's lock would silently match no row.
-- The membership is derived from auth.uid() and p_organization_id, never
-- accepted as a parameter.
--
-- A writer that does not call this function (a client bundle from before
-- it, the one-time legacy migration in lib/data/migration/migrateLocalData.ts,
-- or a direct API call) is still governed by RLS but does not take part in
-- this protocol.

-- Returns the caller's active membership in p_organization_id, locked until
-- the end of the calling transaction.
create function public.lock_own_membership(p_organization_id uuid)
returns uuid
language plpgsql
volatile
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
    and m.status = 'active'
  for no key update;

  if v_membership_id is null then
    raise exception 'You do not have an active membership in this organization.' using errcode = '42501';
  end if;

  return v_membership_id;
end;
$$;

-- The ordinary save's write of the caller's own preferences row - the same
-- statements it used to send directly, in the same order, after the lock:
--   1. UPDATE only the columns named in p_changed_columns;
--   2. if there was no row, INSERT the whole row ON CONFLICT DO NOTHING;
--   3. UPDATE the changed columns again, so they land whoever created the
--      row (a writer outside this protocol may have, between 1 and 2).
-- p_lunch_wave and p_active_bell_schedule_id are the caller's whole row; a
-- column not named in p_changed_columns is used only when creating the row.
create function public.save_teacher_schedule_preferences(
  p_organization_id uuid,
  p_lunch_wave text,
  p_active_bell_schedule_id text,
  p_changed_columns text[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_membership_id uuid;
  v_set_lunch_wave boolean;
  v_set_schedule boolean;
begin
  if p_changed_columns is null
    or not (p_changed_columns <@ array['lunch_wave', 'active_bell_schedule_id']::text[])
  then
    raise exception 'Unrecognized schedule preference column.' using errcode = '22023';
  end if;
  v_set_lunch_wave := 'lunch_wave' = any (p_changed_columns);
  v_set_schedule := 'active_bell_schedule_id' = any (p_changed_columns);
  if not (v_set_lunch_wave or v_set_schedule) then
    return;
  end if;

  -- The lock comes first: nothing below touches the preferences row until
  -- it is held.
  v_membership_id := public.lock_own_membership(p_organization_id);

  update public.teacher_schedule_preferences p
  set lunch_wave = case when v_set_lunch_wave then p_lunch_wave else p.lunch_wave end,
      active_bell_schedule_id = case when v_set_schedule then p_active_bell_schedule_id else p.active_bell_schedule_id end,
      updated_at = now()
  where p.owner_membership_id = v_membership_id;
  if found then
    return;
  end if;

  insert into public.teacher_schedule_preferences (owner_membership_id, organization_id, lunch_wave, active_bell_schedule_id)
  values (v_membership_id, p_organization_id, p_lunch_wave, p_active_bell_schedule_id)
  on conflict (owner_membership_id) do nothing;

  update public.teacher_schedule_preferences p
  set lunch_wave = case when v_set_lunch_wave then p_lunch_wave else p.lunch_wave end,
      active_bell_schedule_id = case when v_set_schedule then p_active_bell_schedule_id else p.active_bell_schedule_id end,
      updated_at = now()
  where p.owner_membership_id = v_membership_id;
end;
$$;

comment on function public.lock_own_membership(uuid) is
  'Locks the caller''s active membership row in p_organization_id (FOR NO KEY UPDATE) until the end of the transaction and returns its id. The lock save_teacher_schedule_preferences() and complete_setup() serialize on.';
comment on function public.save_teacher_schedule_preferences(uuid, text, text, text[]) is
  'The ordinary save''s write of the caller''s own teacher_schedule_preferences row: takes the membership lock first, then updates the changed columns (creating the row if missing) as the caller, under the table''s RLS.';

revoke execute on function public.lock_own_membership(uuid) from public;
revoke execute on function public.lock_own_membership(uuid) from anon;
grant execute on function public.lock_own_membership(uuid) to authenticated;

revoke execute on function public.save_teacher_schedule_preferences(uuid, text, text, text[]) from public;
revoke execute on function public.save_teacher_schedule_preferences(uuid, text, text, text[]) from anon;
grant execute on function public.save_teacher_schedule_preferences(uuid, text, text, text[]) to authenticated;
