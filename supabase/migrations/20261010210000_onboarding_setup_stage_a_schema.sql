-- Falcon Deck streamlined onboarding - Stage A (schema only).
-- See docs/ONBOARDING_SETUP_ARCHITECTURE.md for the decisions this
-- implements. Adds two tables and nothing else: no existing table, policy,
-- function, or grant is altered.
--
--   setup_drafts       - one in-progress guided-setup draft per membership.
--                        Deliberately NOT operational data: nothing in
--                        AppData/SupabaseDataRepository reads or writes it,
--                        and nothing in it is visible to Present Mode until
--                        complete_setup() (Stage B) commits it.
--   setup_completions  - the idempotency ledger for complete_setup(): one
--                        row per committed operation, holding the result
--                        that a retry of the same operation must return.
--
-- ACCESS MODEL: both tables are reachable ONLY through the SECURITY DEFINER
-- functions in Stage B. RLS is enabled with no policies, and every table
-- privilege is explicitly revoked from anon/authenticated - there is no
-- direct PostgREST read or write path at all. This is narrower than the
-- owner-only policies used on the operational tables, on purpose: a draft's
-- revision counter and a completion's stored result are only trustworthy if
-- no caller can write either one directly.
--
-- DELETE BEHAVIOR: owner_membership_id is ON DELETE CASCADE here, unlike the
-- ON DELETE RESTRICT every operational teacher-owned table uses
-- (V2_DATABASE_SCHEMA.md 0.4). That rule exists so removing a membership can
-- never silently destroy classroom data. Neither table holds classroom
-- data: a draft is uncommitted scratch state, and a completion row only
-- describes rows that live (and stay RESTRICT-protected) in the operational
-- tables. CASCADE keeps both from blocking the deliberate, ordered
-- membership purge that rule describes.

create table public.setup_drafts (
  owner_membership_id uuid primary key references public.organization_memberships (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  operation_id uuid not null default gen_random_uuid(),
  revision integer not null default 1 check (revision >= 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- The membership's teacher_schedule_preferences as they stood when this
  -- draft was created (no row = NULL / 'none'). Written once, by
  -- save_setup_draft(), from the database - never from the caller - and
  -- never changed afterwards. No foreign key and no default, on purpose: it
  -- is a record of what was seen, which must survive that schedule being
  -- deleted, and a draft can only be inserted by code that supplies it.
  baseline_active_bell_schedule_id text,
  baseline_lunch_wave text not null check (baseline_lunch_wave in ('A', 'B', 'C', 'none')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_id)
);

comment on table public.setup_drafts is
  'One in-progress guided-setup draft per membership (primary key = owner_membership_id). Not operational data. Reachable only through get_setup_state/save_setup_draft/complete_setup.';
comment on column public.setup_drafts.operation_id is
  'Generated once when the draft is created and never changed. complete_setup() is keyed on it, so every retry of the same completion - from any tab - names the same operation.';
comment on column public.setup_drafts.revision is
  'Optimistic-concurrency counter, incremented by exactly one on every accepted save_setup_draft(). A save or completion that names any other revision is rejected as stale.';

create table public.setup_completions (
  operation_id uuid primary key,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  completed_at timestamptz not null default now(),
  -- At most one completed guided setup per membership, structurally: two
  -- different operations for the same membership can never both commit.
  unique (owner_membership_id)
);

comment on column public.setup_drafts.baseline_lunch_wave is
  'With baseline_active_bell_schedule_id: the schedule preferences in force when the draft was created. complete_setup() refuses to replace preferences that have since been changed outside guided setup to anything the draft does not itself ask for.';

comment on table public.setup_completions is
  'Idempotency ledger for complete_setup(): written in the same transaction as the rows it describes. A retry of a committed operation_id returns result unchanged and writes nothing.';

alter table public.setup_drafts enable row level security;
alter table public.setup_completions enable row level security;

-- No policies are created (see ACCESS MODEL above). The revokes are stated
-- explicitly rather than relied on as a default.
revoke all on table public.setup_drafts from public, anon, authenticated;
revoke all on table public.setup_completions from public, anon, authenticated;
