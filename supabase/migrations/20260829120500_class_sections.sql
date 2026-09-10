-- Falcon Deck V2 Supabase Foundation - Stage B, migration 6 of 13.
-- Table spec verbatim from docs/V2_DATABASE_SCHEMA.md §2.9.

create table public.class_sections (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete restrict,
  course_id text not null,
  name text not null,
  room text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, owner_membership_id, id),
  foreign key (organization_id, course_id) references public.courses (organization_id, id)
);

alter table public.class_sections enable row level security;

-- Strictly owner-only (V2_ARCHITECTURE.md §5): no same-organization
-- exception, no admin exception. SELECT/DELETE use app_owns_membership()
-- alone; INSERT/UPDATE's WITH CHECK use app_owns_membership_in_org() per
-- the architecture decision applied consistently from courses onward, so a
-- write can never attach this row's organization_id to a membership from a
-- different organization. UPDATE's USING clause stays ownership-based.
create policy "class_sections_select"
  on public.class_sections for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "class_sections_insert"
  on public.class_sections for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "class_sections_update"
  on public.class_sections for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "class_sections_delete"
  on public.class_sections for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));
