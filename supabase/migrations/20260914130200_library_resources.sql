-- Falcon Deck V2 Supabase Foundation - Stage B, migration 12 of 13.
-- Table specs verbatim from docs/V2_DATABASE_SCHEMA.md §2.15 and §2.16
-- (+ §0.6 timestamps). Teacher-scoped reusable resource library.

create table public.library_resources (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete restrict,
  title text not null,
  url text not null,
  type text not null check (type in ('link','document','slides','video','desmos','calculator','pdf','image','spreadsheet','other')),
  tags text[] not null default '{}',
  notes text,
  is_favorite boolean not null default false,
  source_kind text not null default 'manual' check (source_kind in ('manual', 'google-drive')),
  source_drive_file_id text,
  source_mime_type text,
  source_web_view_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.library_resources enable row level security;

-- Strictly owner-only (§2.15).
create policy "library_resources_select"
  on public.library_resources for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "library_resources_insert"
  on public.library_resources for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "library_resources_update"
  on public.library_resources for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "library_resources_delete"
  on public.library_resources for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create table public.library_resource_courses (
  library_resource_id text not null references public.library_resources (id) on delete cascade,
  course_id text not null references public.courses (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (library_resource_id, course_id)
);

-- course_id uses a plain, single-column FK (audit-corrected in the doc -
-- the composite version was dropped, §8): a low-stakes "tag-like"
-- association on a row already fully RLS-protected by its own
-- organization_id/owner_membership_id. A wrong-org course tag is a cosmetic
-- filtering mismatch, not a functional integrity failure. Same-organization
-- validation is an application-layer invariant here, deliberately not
-- database-enforced (§2.16).

alter table public.library_resource_courses enable row level security;

create policy "library_resource_courses_select"
  on public.library_resource_courses for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "library_resource_courses_insert"
  on public.library_resource_courses for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "library_resource_courses_update"
  on public.library_resource_courses for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "library_resource_courses_delete"
  on public.library_resource_courses for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));
