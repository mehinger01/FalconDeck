# Falcon Deck V2 — Database Schema Design

**Status: design only.** Nothing in this document has been applied to Supabase. No
migrations exist. No authentication has been configured. `DataRepository` and the
current application are untouched. This document is the schema-level continuation of
`docs/V2_ARCHITECTURE.md`, which is treated here as the locked source of truth — no
rule in that document is reinterpreted or contradicted below. This is the corrected
design that survived a dedicated relational-integrity and simplicity audit — every
foreign key, delete behavior, and constraint below has been checked against a real
PostgreSQL target, not just type-compatibility.

SQL shown in this document is **descriptive DDL for review**, not a migration to run.

---

## 0. Cross-cutting conventions

**0.1 Primary key type follows data origin, not table "newness."**
A table whose rows can originate from a teacher's existing local (`localStorage`)
data uses `id text primary key` — preserving the exact id `generateId()` already
produces today, so migration can upsert by id and be naturally idempotent (§9). A
table with no local precedent uses `id uuid primary key default gen_random_uuid()`.

**A foreign key column always matches the type of the column it references,
regardless of the referencing table's own PK convention.** `organization_memberships.id`
is `uuid` (no local precedent), so **every** `owner_membership_id` column in this
schema is `uuid`, even on tables whose own `id` is `text`.

**0.2 Ownership is denormalized onto every row, never inferred through a join.**
Every non-platform table carries `organization_id`. Every teacher-scoped table
additionally carries `owner_membership_id`. Child tables also carry their own copies
of these columns even though derivable from a parent row — deliberate denormalization
for RLS simplicity, not accidental duplication (§10).

**0.3 Dual ownership (organization-owned vs. teacher-owned)** uses one shared
discriminator pattern, applied identically to `courses` and `bell_schedules`:

```sql
owner_type text NOT NULL CHECK (owner_type IN ('organization', 'teacher')),
owner_membership_id uuid REFERENCES organization_memberships(id) ON DELETE RESTRICT,
CONSTRAINT owner_membership_matches_owner_type CHECK (
  (owner_type = 'organization' AND owner_membership_id IS NULL) OR
  (owner_type = 'teacher' AND owner_membership_id IS NOT NULL)
)
```

**0.4 Deletion of a membership or its underlying account never silently deletes
owned classroom data.** Every teacher-owned table's `owner_membership_id` is
`ON DELETE RESTRICT`, and `organization_memberships.user_id → profiles(id)` is also
`ON DELETE RESTRICT`. Concretely: **an `auth.users` row with any existing
membership — active, invited, or already `'removed'` — cannot be deleted at all**
until every row that membership owns is explicitly resolved (deleted or reassigned)
first, and the membership itself deleted, in that order. This is intentional: it
makes the routine offboarding path `organization_memberships.status = 'removed'`
(no row deletion at all — full history retained) the only thing that "just works,"
while any *actual* destructive purge (e.g. a GDPR erasure request) requires a
deliberate, ordered, service-role operation rather than falling out automatically
from an `auth.users` deletion. `docs/V2_ARCHITECTURE.md` §13 leaves the real
retention *policy* (how long, who decides) open; this schema only guarantees that
policy can't be accidentally pre-empted by a cascade. `profiles.id → auth.users(id)`
keeps `ON DELETE CASCADE` (standard Supabase convention — Auth Admin API deletion is
already a deliberate action). `organizations.id →` every org-owned child table keeps
`ON DELETE CASCADE` (a whole-tenant deletion is a different, rarer, explicitly
deliberate operation than removing one person; no self-serve org deletion exists in
V2).

**0.5 Cross-organization/cross-owner leakage is a structural guarantee on exactly
seven relationships, chosen deliberately, not applied blanket-wide.** §8 documents
which relationships get a database-enforced composite foreign key and which remain
application-layer invariants, and why each choice was made — including four
relationships where a composite FK was considered and rejected during audit,
because either (a) it would have created a broken `ON DELETE SET NULL` (attempting
to null a `NOT NULL` denormalized column), or (b) the relationship is low-stakes
enough that RLS plus a documented write-time invariant is the right amount of
protection, not database-level enforcement.

**0.6** Every table carries `created_at timestamptz not null default now()` and
`updated_at timestamptz not null default now()`. Omitted from individual listings
for brevity.

---

## 1. Text ERD

```
organizations
 ├─ organization_memberships (per user)
 │   └─ local_data_migrated_at  (migration marker; see §7)
 ├─ organization_settings            (1:1 — branding)
 ├─ school_year_calendars (0..N per school_year; exactly one is_canonical; §6)
 │   └─ school_calendar_exceptions ──references──> bell_schedules (plain FK, SET NULL)
 ├─ courses            (owner_type = organization; the catalog)
 └─ bell_schedules      (owner_type = organization)
     └─ schedule_blocks
         └─ schedule_block_overrides (per weekday)

organization_memberships (= one teacher, inside one organization)
 ├─ courses             (owner_type = teacher; custom courses)
 ├─ bell_schedules       (owner_type = teacher; fully custom/duplicated schedules)
 │   └─ schedule_blocks (class_section_id embedded directly — teacher-owned only;
 │       │                plain FK, SET NULL)
 │       └─ schedule_block_overrides (class_section_id: plain FK, SET NULL)
 ├─ teacher_period_assignments ──> schedule_blocks (org-owned only, composite FK,
 │      CASCADE) + class_sections (composite FK, CASCADE)
 ├─ class_sections ──> courses (catalog or custom; composite FK)
 │   ├─ lesson_class_sections ──> lessons (composite FK, CASCADE; §6)
 │   └─ class_presentation_settings      (1:1 — arrival routine)
 ├─ lessons ──> courses (composite FK; a lesson belongs to a course, not a section; §6)
 ├─ library_resources
 │   └─ library_resource_courses ──> courses (plain FK, CASCADE)
 ├─ classroom_experience_settings   (1:1 — personal Present Mode prefs + branding override)
 └─ teacher_schedule_preferences    (1:1 — e.g. lunch wave)

profiles (mirrors auth.users 1:1) ──> organization_memberships
```

---

## 2. Table specifications

### 2.1 `profiles`

```sql
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text
);
```
- **Ownership:** platform-scoped.
- **RLS:** a user reads/updates only their own row (`id = auth.uid()`).

### 2.2 `organizations`

```sql
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  UNIQUE (slug)
);
```
- **RLS:** `SELECT` for any authenticated user (needed for "select your school"
  onboarding); write restricted to service-role/trusted tooling.

### 2.3 `organization_memberships`

```sql
CREATE TABLE organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'removed')),
  subject_area text,
  local_data_migrated_at timestamptz,
  UNIQUE (organization_id, user_id)
);
```
- **`user_id` is `ON DELETE RESTRICT`** — see §0.4.
- **RLS:** a user reads their own row(s); an admin reads/writes every row within
  their own organization; never across organizations.

### 2.4 `organization_settings` (branding)

```sql
CREATE TABLE organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  watermark_storage_path text,
  watermark_opacity numeric(3,2) NOT NULL DEFAULT 0.35 CHECK (watermark_opacity BETWEEN 0 AND 1),
  branding_locked boolean NOT NULL DEFAULT false
);
```
- Organization branding is the default; a teacher's override lives on
  `classroom_experience_settings` (§2.18), never here.
- `watermark_storage_path` holds a Supabase Storage path, not an inline base64 image
  (§9).
- **RLS:** `SELECT` for any member; `INSERT`/`UPDATE` for admins only.

### 2.5 `courses` *(Design Problem A — §4)*

```sql
CREATE TABLE courses (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('organization', 'teacher')),
  owner_membership_id uuid REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  name text NOT NULL,
  color_hex text,
  description text,
  CONSTRAINT courses_owner_matches_type CHECK (
    (owner_type = 'organization' AND owner_membership_id IS NULL) OR
    (owner_type = 'teacher' AND owner_membership_id IS NOT NULL)
  ),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX courses_catalog_name_ci
  ON courses (organization_id, lower(name)) WHERE owner_type = 'organization';
```
- **`UNIQUE (organization_id, id)`** exists solely to support the two composite FKs
  that reference `courses` (from `class_sections` and `lessons`, §8).
- **RLS:** organization rows readable by any member, writable by admins; teacher
  rows owner-only.

### 2.6 `bell_schedules` *(Design Problem B — §5)*

```sql
CREATE TABLE bell_schedules (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('organization', 'teacher')),
  owner_membership_id uuid REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  profile_key text,
  name text NOT NULL,
  description text,
  time_zone text NOT NULL DEFAULT 'America/Detroit',
  is_default boolean NOT NULL DEFAULT false,
  source text CHECK (source IN ('built-in', 'custom', 'imported')),
  needs_configuration boolean NOT NULL DEFAULT false,
  CONSTRAINT bell_schedules_owner_matches_type CHECK (
    (owner_type = 'organization' AND owner_membership_id IS NULL) OR
    (owner_type = 'teacher' AND owner_membership_id IS NOT NULL)
  ),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX bell_schedules_profile_key
  ON bell_schedules (organization_id, profile_key) WHERE profile_key IS NOT NULL;
```
- **`UNIQUE (organization_id, id)`** supports the composite FK from
  `school_year_calendars` (§8).
- **`is_default`** meaningful primarily for teacher-owned rows; once an organization
  calendar exists, its `default_bell_schedule_id` (§2.11) is authoritative for the
  org's default.
- **RLS:** same shape as `courses`.

### 2.7 `schedule_blocks`

```sql
CREATE TABLE schedule_blocks (
  id text PRIMARY KEY,
  bell_schedule_id text NOT NULL REFERENCES bell_schedules(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('organization', 'teacher')),
  owner_membership_id uuid REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  position integer NOT NULL,
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('instructional', 'enrichment', 'prep', 'lunch', 'passing', 'custom')),
  custom_kind_label text,
  start_time time NOT NULL,
  end_time time NOT NULL,
  class_section_id text REFERENCES class_sections(id) ON DELETE SET NULL,
  is_lunch_window boolean NOT NULL DEFAULT false,
  UNIQUE (bell_schedule_id, position),
  UNIQUE (organization_id, id)
);
```
- **`class_section_id` uses a plain, single-column FK with `ON DELETE SET NULL`
  (audit-corrected).** A composite FK spanning `(organization_id,
  owner_membership_id, class_section_id)` was considered and rejected: `SET NULL`
  on a composite FK nulls *every* referencing column, including this row's own
  `organization_id`/`owner_membership_id` — which are required, denormalized RLS
  columns, not columns that should ever be nulled. Same-organization/same-teacher
  validation for this field is therefore an **application-layer invariant**: the
  single write path must ensure a value here always belongs to the same
  organization and teacher as the block itself.
- **`UNIQUE (organization_id, id)`** is new — required to support the composite FK
  from `teacher_period_assignments` (§8); this table had no such constraint in an
  earlier draft, which was a genuine bug (a composite FK referencing a
  non-unique/non-existent target).
- **Application-layer invariant, also not DB-enforced:** `class_section_id` must
  stay `NULL` when the *parent* `bell_schedules.owner_type = 'organization'` —
  depends on a different table's column, not expressible as a plain `CHECK`.
- **RLS:** matches the parent schedule, via this row's own denormalized columns.

### 2.8 `schedule_block_overrides`

```sql
CREATE TABLE schedule_block_overrides (
  id text PRIMARY KEY,
  schedule_block_id text NOT NULL REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('organization', 'teacher')),
  owner_membership_id uuid REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  weekday text NOT NULL CHECK (weekday IN ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),
  label text,
  kind text CHECK (kind IN ('instructional', 'enrichment', 'prep', 'lunch', 'passing', 'custom')),
  custom_kind_label text,
  class_section_overridden boolean NOT NULL DEFAULT false,
  class_section_id text REFERENCES class_sections(id) ON DELETE SET NULL,
  start_time time,
  end_time time,
  UNIQUE (schedule_block_id, weekday)
);
```
- **`class_section_id`** — same audit correction as §2.7: plain FK, `SET NULL`,
  same-org/same-teacher left as an application-layer invariant.
- **`class_section_overridden`** solves the tri-state problem: today's
  `ScheduleBlockOverride.classSectionId` is `undefined` (inherit) / `null`
  (explicit unassign) / a string (reassign) — three states one nullable SQL column
  can't represent. `class_section_overridden = false` ⇒ ignore `class_section_id`
  entirely; `true` ⇒ it's either `NULL` (explicit unassignment) or a real id.
- **RLS:** matches `schedule_blocks`.

### 2.9 `class_sections`

```sql
CREATE TABLE class_sections (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  course_id text NOT NULL,
  name text NOT NULL,
  room text,
  UNIQUE (organization_id, owner_membership_id, id),
  FOREIGN KEY (organization_id, course_id) REFERENCES courses (organization_id, id)
);
```
- **`course_id`'s composite FK (retained)** guarantees a class section can never
  reference a course from a *different organization* — a real, functionally
  damaging integrity error (not just a cosmetic mismatch), so this is one of the
  seven relationships kept database-enforced (§8). It does **not** guarantee the
  course is either catalog-owned or owned by this same teacher — that specific
  check is disjunctive (catalog-or-own-custom) and can't be expressed as a plain
  FK; left as an application-layer invariant.
- **`UNIQUE (organization_id, owner_membership_id, id)`** supports composite FKs
  from `teacher_period_assignments` and `lesson_class_sections` (§8).
- **RLS:** strictly owner-only.

### 2.10 `teacher_period_assignments`

```sql
CREATE TABLE teacher_period_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  schedule_block_id text NOT NULL,
  override_weekday text CHECK (override_weekday IN ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),
  class_section_id text NOT NULL,
  FOREIGN KEY (organization_id, schedule_block_id)
    REFERENCES schedule_blocks (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, owner_membership_id, class_section_id)
    REFERENCES class_sections (organization_id, owner_membership_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX teacher_period_assignments_base
  ON teacher_period_assignments (owner_membership_id, schedule_block_id)
  WHERE override_weekday IS NULL;

CREATE UNIQUE INDEX teacher_period_assignments_weekday
  ON teacher_period_assignments (owner_membership_id, schedule_block_id, override_weekday)
  WHERE override_weekday IS NOT NULL;
```
*(Exactly one `_base` index and one `_weekday` index.)*

- **Both composite FKs retained, both now with explicit `ON DELETE CASCADE`**
  (audit-corrected — an earlier draft omitted the `ON DELETE` clause entirely,
  contradicting this document's own prose about stale assignments being cleaned up
  automatically when a shared block is deleted). `CASCADE` has no partial-null
  problem on a composite FK, unlike `SET NULL`.
- `schedule_block_id`'s composite FK guarantees the referenced block belongs to the
  *same organization* as the assignment. `class_section_id`'s composite FK
  guarantees the referenced section belongs to the *same organization and same
  teacher*. This is the bridge table the whole V2 architecture is built around, so
  both relationships are database-enforced, not just RLS-trusted.
- **Why two partial unique indexes, not one composite `UNIQUE`:** Postgres treats
  every `NULL` as distinct in a plain unique constraint, so a single `UNIQUE
  (owner_membership_id, schedule_block_id, override_weekday)` would silently
  *allow* duplicate base (non-weekday) assignments. `_base` closes that gap for the
  `NULL` case; `_weekday` is ordinary composite uniqueness for real weekday values.
- **Application-layer invariant, not DB-enforced:** `schedule_block_id` should
  reference a block whose parent `bell_schedules.owner_type = 'organization'`.
- **RLS:** strictly owner-only.

### 2.11 `school_year_calendars` *(Design Problem D — §6)*

```sql
CREATE TABLE school_year_calendars (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  school_year text NOT NULL,
  time_zone text NOT NULL DEFAULT 'America/Detroit',
  first_student_day date,
  last_student_day date,
  is_canonical boolean NOT NULL DEFAULT false,
  default_bell_schedule_id text NOT NULL,
  FOREIGN KEY (organization_id, default_bell_schedule_id)
    REFERENCES bell_schedules (organization_id, id)
);

CREATE UNIQUE INDEX school_year_calendars_one_canonical
  ON school_year_calendars (organization_id, school_year)
  WHERE is_canonical;
```
- **Any number of rows may exist for a given `(organization_id, school_year)`** —
  drafts, alternates, future per-program variants. The **partial** unique index
  enforces only "at most one canonical calendar per organization per school year,"
  the actual invariant that matters, without a plain `UNIQUE (organization_id,
  school_year)` that would foreclose future flexibility. For OHHS in V2: exactly
  one row, `is_canonical = true`.
- **`default_bell_schedule_id`'s composite FK (retained)** guarantees the
  calendar's default schedule belongs to the same organization; required field, so
  the default `NO ACTION` behavior (no explicit `ON DELETE` clause) correctly blocks
  deleting a schedule a calendar still depends on.
- **RLS:** `SELECT` for any member; admin-only writes.

### 2.12 `school_calendar_exceptions`

```sql
CREATE TABLE school_calendar_exceptions (
  id text PRIMARY KEY,
  school_year_calendar_id text NOT NULL REFERENCES school_year_calendars(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  type text NOT NULL CHECK (type IN ('no-school', 'no-students', 'special-bell')),
  title text NOT NULL,
  bell_schedule_id text REFERENCES bell_schedules(id) ON DELETE SET NULL,
  source_schedule_profile text,
  dismissal_time text,
  notes text
);
```
- **`bell_schedule_id` uses a plain, single-column FK with `ON DELETE SET NULL`
  (audit-corrected).** A composite `(organization_id, bell_schedule_id)` FK was
  considered and rejected: `SET NULL` on that composite would attempt to null
  `organization_id` too, which is `NOT NULL` on this table — a genuine constraint
  violation waiting to happen, not just a style concern. Same-organization
  validation for this optional field is an **application-layer invariant**.
- No overlap-prevention constraint, deliberately — the app's own
  `detectCalendarConflicts` + skip/replace resolution UI already handles this; a
  DB-level exclusion constraint would fight that workflow.
- **RLS:** `SELECT` for any member; admin-only writes.

### 2.13 `lessons` *(Design Problem C — §6, unchanged)*

```sql
CREATE TABLE lessons (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  course_id text NOT NULL,
  lesson_date date NOT NULL,
  learning_target text NOT NULL DEFAULT '',
  agenda_items jsonb NOT NULL DEFAULT '[]',
  resources jsonb NOT NULL DEFAULT '[]',
  announcements jsonb NOT NULL DEFAULT '[]',
  UNIQUE (organization_id, owner_membership_id, id),
  FOREIGN KEY (organization_id, course_id) REFERENCES courses (organization_id, id)
);
```
- **`course_id`'s composite FK (retained)** — same reasoning as `class_sections`
  (§2.9): a lesson wired to a different organization's course is a functional
  integrity error worth database enforcement.
- **`UNIQUE (organization_id, owner_membership_id, id)`** supports the composite FK
  from `lesson_class_sections` (§8).
- No unique constraint on `(course_id, lesson_date)`, deliberately — see §6; the
  real "one lesson per section per day" invariant lives on `lesson_class_sections`.
- **RLS:** strictly owner-only.

### 2.14 `lesson_class_sections`

```sql
CREATE TABLE lesson_class_sections (
  lesson_id text NOT NULL,
  class_section_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  lesson_date date NOT NULL,
  PRIMARY KEY (lesson_id, class_section_id),
  UNIQUE (class_section_id, lesson_date),
  FOREIGN KEY (organization_id, owner_membership_id, lesson_id)
    REFERENCES lessons (organization_id, owner_membership_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, owner_membership_id, class_section_id)
    REFERENCES class_sections (organization_id, owner_membership_id, id) ON DELETE CASCADE
);
```
*(Complete: `lesson_id`, `class_section_id`, `organization_id`, `owner_membership_id`,
`lesson_date`, primary key, explicit uniqueness constraint, both composite FKs with
explicit `ON DELETE CASCADE` — audit-corrected; an earlier draft omitted the
`ON DELETE` clause here too.)*

- **Both composite FKs retained** — explicitly named in this audit as the highest-
  value case: they make it a **database-structural impossibility**, not just an
  RLS-trusted assumption, for this table to link a lesson and section belonging to
  different teachers or different organizations.
- **`UNIQUE (class_section_id, lesson_date)`** is the actual "at most one lesson
  per section per day" invariant, matching `findLessonForSection`'s current
  behavior exactly.
- **RLS:** strictly owner-only.

### 2.15 `library_resources`

```sql
CREATE TABLE library_resources (
  id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  title text NOT NULL,
  url text NOT NULL,
  type text NOT NULL CHECK (type IN ('link','document','slides','video','desmos','calculator','pdf','image','spreadsheet','other')),
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  is_favorite boolean NOT NULL DEFAULT false,
  source_kind text NOT NULL DEFAULT 'manual' CHECK (source_kind IN ('manual', 'google-drive')),
  source_drive_file_id text,
  source_mime_type text,
  source_web_view_url text
);
```
- **RLS:** strictly owner-only.

### 2.16 `library_resource_courses`

```sql
CREATE TABLE library_resource_courses (
  library_resource_id text NOT NULL REFERENCES library_resources(id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  PRIMARY KEY (library_resource_id, course_id)
);
```
- **`course_id` uses a plain, single-column FK (audit-corrected — the composite
  version was dropped).** This is a low-stakes "tag-like" association (which
  course a resource is filed under) on a row that is already fully RLS-protected
  by its own `organization_id`/`owner_membership_id`; a wrong-org course tag is a
  cosmetic filtering mismatch, not a functional integrity failure like a
  misdirected section or lesson would be. Same-organization validation is an
  **application-layer invariant** here, deliberately not database-enforced — the
  simplicity/value trade-off went the other way than for `class_sections`/`lessons`.
- **RLS:** strictly owner-only.

### 2.17 `class_presentation_settings`

```sql
CREATE TABLE class_presentation_settings (
  class_section_id text PRIMARY KEY REFERENCES class_sections(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_membership_id uuid NOT NULL REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  arrival_instructions text[] NOT NULL DEFAULT '{}'
);
```
- **RLS:** strictly owner-only.

### 2.18 `classroom_experience_settings`

```sql
CREATE TABLE classroom_experience_settings (
  owner_membership_id uuid PRIMARY KEY REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  final_five_message text NOT NULL DEFAULT '',
  show_end_of_day_screen boolean NOT NULL DEFAULT true,
  end_of_day_message text NOT NULL DEFAULT 'Have a great afternoon.',
  clean_screen_default_message text NOT NULL DEFAULT 'Work Time',
  show_clock_on_clean_screen boolean NOT NULL DEFAULT true,
  transition_countdown_enabled boolean NOT NULL DEFAULT true,
  transition_arrival_instructions_enabled boolean NOT NULL DEFAULT true,
  watermark_override_storage_path text,
  watermark_override_opacity numeric(3,2) CHECK (watermark_override_opacity IS NULL OR watermark_override_opacity BETWEEN 0 AND 1)
);
```
- `watermark_override_storage_path`: `NULL` ⇒ render the organization's default
  (§2.4); set ⇒ the teacher's own wins.
- **RLS:** strictly owner-only.

### 2.19 `teacher_schedule_preferences`

```sql
CREATE TABLE teacher_schedule_preferences (
  owner_membership_id uuid PRIMARY KEY REFERENCES organization_memberships(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lunch_wave text NOT NULL DEFAULT 'none' CHECK (lunch_wave IN ('A', 'B', 'C', 'none'))
);
```
- **RLS:** strictly owner-only.

### 2.20 Explicitly not part of this schema: Google Drive
No `google_drive_connections` table. Per the locked decision, today's anonymous,
cookie-based integration remains untouched and unrepresented in Supabase until its
own dedicated later milestone.

**Table count: 19** (§2.1–§2.19). Every required domain area from the task brief is
covered — several areas (e.g. "lessons and their relationship to courses/sections")
deliberately span more than one physical table (`lessons` + `lesson_class_sections`).

---

## 3. Onboarding/setup-state: why no persisted table

Every checklist item `getOnboardingStatus` computes today is a straightforward query
against §2's tables, and persisting it would duplicate information the base tables
already hold, with the same staleness risk the current design deliberately avoids.
The one genuinely non-derivable fact — "has this browser's local data already been
migrated" — gets exactly one column, `organization_memberships.local_data_migrated_at`
(§2.3), not a new table.

---

## 4. Design Problem A — Course ownership
One `courses` table, discriminated by `owner_type` (§0.3/§2.5). Rejected: two
separate tables — every downstream FK to "a course" would otherwise need to be
nullable-and-duplicated.

## 5. Design Problem B — Bell schedule ownership
One `bell_schedules` table (+ child `schedule_blocks`/`schedule_block_overrides`),
discriminated the same way, plus `teacher_period_assignments` (§2.10) as the bridge.
Directly satisfies "never duplicate the org schedule per teacher" and "migration
never creates/promotes/overwrites the canonical schedule."

## 6. Design Problem C — Lesson reuse across sections
Unchanged, per the approved direction: `lessons` belongs to a course and a date;
`lesson_class_sections` links it to one or more of a teacher's sections for that
date, with the real "one lesson per section per day" constraint enforced there via
`UNIQUE (class_section_id, lesson_date)`. Intentional section-specific divergence is
a second, independent `lessons` row linked instead — never a patch/override record.
No `LessonPlan`/`Occurrence` split, no LMS, no version-control system.

## 7. Design Problem D — Calendar structure
`is_canonical` + a partial unique index (§2.11) — see there for full detail.

---

## 8. Cross-owner / cross-organization FK integrity

Seven composite foreign keys are retained; four were considered and dropped during
audit. Each is listed with its reasoning.

**Retained (7):**

| Relationship | Guarantees | Delete behavior |
|---|---|---|
| `class_sections(organization_id, course_id) → courses(organization_id, id)` | Same organization | Effectively `RESTRICT` (required field) |
| `lessons(organization_id, course_id) → courses(organization_id, id)` | Same organization | Effectively `RESTRICT` |
| `teacher_period_assignments(organization_id, schedule_block_id) → schedule_blocks(organization_id, id)` | Same organization | `CASCADE` (explicit) |
| `teacher_period_assignments(organization_id, owner_membership_id, class_section_id) → class_sections(...)` | Same organization **and** same teacher | `CASCADE` (explicit) |
| `school_year_calendars(organization_id, default_bell_schedule_id) → bell_schedules(organization_id, id)` | Same organization | Effectively `RESTRICT` |
| `lesson_class_sections(organization_id, owner_membership_id, lesson_id) → lessons(...)` | Same organization **and** same teacher | `CASCADE` (explicit) |
| `lesson_class_sections(organization_id, owner_membership_id, class_section_id) → class_sections(...)` | Same organization **and** same teacher | `CASCADE` (explicit) |

**Dropped (4), with reasons:**

| Relationship | Why dropped |
|---|---|
| `schedule_blocks.class_section_id → class_sections` (composite) | `ON DELETE SET NULL` on a composite FK would null this row's own required `organization_id`/`owner_membership_id`. Reverted to a plain FK + `SET NULL`. |
| `schedule_block_overrides.class_section_id → class_sections` (composite) | Same reason. |
| `school_calendar_exceptions.bell_schedule_id → bell_schedules` (composite) | Same reason — would null the table's required `organization_id`. Reverted to a plain FK + `SET NULL`. |
| `library_resource_courses.course_id → courses` (composite) | Low-stakes tag-like relationship, already fully RLS-protected by the row's own ownership columns; not worth the ceremony relative to the four scheduling/lesson relationships above, which carry real functional consequences if crossed. |

**Why "references another teacher's private course" is never a composite FK,
anywhere it applies (`class_sections.course_id`, `lessons.course_id`):** the
legitimate relationship is a disjunction — *either* "same org, catalog course" *or*
"same org, same teacher, custom course." A composite FK can only express a
conjunction of equalities, and catalog courses have `owner_membership_id IS NULL`,
so a same-teacher composite FK would incorrectly reject every legitimate reference
to a catalog course. This specific check is application-layer everywhere it
applies, not a gap unique to any one table.

**Denormalized-column consistency — what's DB-guaranteed vs. application-layer:**

| Table | Denormalized columns | Guaranteed to match parent? |
|---|---|---|
| `teacher_period_assignments` | `organization_id`, `owner_membership_id` | **Yes** — both retained composite FKs force exact match. |
| `lesson_class_sections` | `organization_id`, `owner_membership_id` | **Yes** — both retained composite FKs force exact match. |
| `schedule_blocks` | `organization_id`, `owner_membership_id` (vs. parent `bell_schedules`) | **No — application-layer.** `bell_schedule_id`'s FK is plain. |
| `schedule_block_overrides` | Same, vs. parent `schedule_blocks` | **No — application-layer.** |
| `library_resource_courses` | `organization_id`, `owner_membership_id` | **No — application-layer**, now that `course_id`'s FK is plain. |

**One universal, deliberately-accepted gap, stated explicitly:** on every
teacher-owned table (all with `owner_membership_id`), nothing in this schema
DB-guarantees that a row's own `organization_id` equals the `organization_id` of the
`organization_memberships` row its `owner_membership_id` points to — every
`owner_membership_id` FK is a plain reference to `organization_memberships(id)`, not
composite against `organization_memberships(organization_id, id)`. Closing this
fully would require a composite FK (and a new supporting unique index on
`organization_memberships`) on all thirteen tables that carry `owner_membership_id`
— disproportionate ceremony for a case that's structurally hard to hit by accident,
since both columns are always written together by the same single write path. This
is the single largest simplicity trade-off in this schema, named here rather than
left to be rediscovered later.

**Net result:** 7 composite foreign keys, reserved for relationships where crossing
a tenant/ownership boundary would cause a real functional integrity failure — not a
blanket pattern, and no triggers were introduced anywhere to close a gap.

---

## 9. Migration compatibility: current `AppData` → proposed tables

| Current concept | Proposed table(s) | Notes / flags |
|---|---|---|
| `courses` (`Course[]`) | `courses`, `owner_type = 'teacher'` | Clean mapping. The org catalog is seeded separately, never derived from a migrating teacher's courses. |
| `classSections` (`ClassSection[]`) | `class_sections` | Clean mapping. |
| `schedules` where `source: "built-in"` | *(not migrated as new data)* | **Flag:** the canonical `bell_schedules` row already exists (seeded separately). The teacher's local copy is only a *source* for reconciling `classSectionId` assignments — never itself written to Supabase. |
| `schedules` where `source: "custom"`/`"imported"` | `bell_schedules`, `owner_type = 'teacher'` | Clean mapping. |
| `ScheduleBlock.classSectionId` on a local copy of an org preset | `teacher_period_assignments` | **Flag — application-layer matching, not id copy.** Blocks are matched against the canonical schedule by content (position/label/time), since block ids are independent by construction. |
| `ScheduleBlock.classSectionId` on a genuinely custom schedule | Stays on `schedule_blocks.class_section_id` | Clean mapping. |
| `ScheduleBlockOverride.classSectionId` | Tri-state → `class_section_overridden` + `class_section_id` (§2.8) | **Flag:** doesn't map onto one nullable column cleanly. |
| `schoolCalendar` | `school_year_calendars` + `school_calendar_exceptions` | **Flag — compare-then-reconcile, never copy.** Canonical row seeded once; a migrating teacher's local calendar is compared, not copied. |
| `lessons` (`DailyLesson[]`) | One `lessons` row + one `lesson_class_sections` row per existing lesson | **Flag — shape changes, but 1:1, no merging.** Reuse across sections is a going-forward action, never inferred at migration time. |
| `libraryResources` | `library_resources` + `library_resource_courses` | Clean mapping; `courseIds: string[]` becomes join rows. |
| `classPresentationSettings` | `class_presentation_settings` | Clean mapping. |
| `classroomExperienceSettings.customWatermarkDataUrl` | `classroom_experience_settings.watermark_override_storage_path` | **Flag — needs transformation.** Upload to Supabase Storage once; store only the path, never the base64 string. |
| `classroomExperienceSettings` (remaining fields) | `classroom_experience_settings` | Clean mapping. |
| `teacherSchedulePreferences` | `teacher_schedule_preferences` | Clean mapping — already correctly modeled today. |
| Drive OAuth cookie | *(not represented in this schema)* | Not migrated — deferred. |
| Onboarding status | *(stays derived — §3)* | No table; only `local_data_migrated_at` is new. |
| Local ids (`generateId()`) | Preserved verbatim as `text` PKs | New-in-V2 rows (`teacher_period_assignments`, `organizations`, `organization_memberships`, etc.) have no legacy id and use `uuid` instead — the schema intentionally mixes both id styles (§10). |
| `BellSchedule.isDefault` | `bell_schedules.is_default` | **Flag — meaning narrows** once an organization calendar exists (§2.6). |

---

## 10. Schema simplicity self-review

- **`text`/`uuid` PK split (§0.1):** intentional, to preserve local ids verbatim for
  idempotent migration. Fallback if this proves awkward: `uuid` everywhere plus a
  `legacy_local_id text` column used only for migration-time upsert matching.
- **`class_section_overridden` (§2.8):** the one clear case of SQL being visibly
  less expressive than the current TypeScript type it replaces.
- **`teacher_period_assignments`'s two-partial-unique-index pattern (§2.10):** a
  genuine Postgres gotcha, worth a code comment pointing back to this document
  when the real migration is written.
- **Matching local OHHS-preset blocks to the canonical schedule by content, not id
  (§9):** the single most implementation-risky step in the whole migration; deserves
  dedicated test coverage.
- **Deliberately not built:** `google_drive_connections`, a separate
  `onboarding_states` table, a lesson-plan/occurrence split, aggregate-repository
  interfaces, realtime subscriptions, RLS SQL, and (after this audit) four
  composite foreign keys that would have either been broken (`SET NULL` on required
  denormalized columns) or disproportionate to their value.
- **Where RLS is genuinely harder:** the four mixed-ownership tables (`courses`,
  `bell_schedules`, `schedule_blocks`, `schedule_block_overrides`) each need their
  row-level policy to branch on that row's own `owner_type`, rather than the table
  having one uniform rule.
- **The universal `organization_id`-vs-`owner_membership_id` consistency gap
  (§8):** the largest deliberately-accepted trade-off in this schema — flagged
  explicitly rather than silently assumed away.

---

*This document describes proposed schema design only. No migration has been
applied, and no Supabase project has been touched.*
