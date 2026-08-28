# Falcon Deck V2 Architecture

**Status:** Architecture and analysis only. No Supabase tables, no authentication, no
application behavior changes. This is a clean-room reconstruction of the reviewed and
approved V2 architecture, produced to remove duplicated/superseded text that
accumulated in `docs/V2_ARCHITECTURE.md` during iterative editing. It supersedes that
document's content once reviewed and approved; `docs/V2_ARCHITECTURE.md` itself is
untouched by this pass.

---

## 0. Architecture Principles and Locked Decisions

**Core ownership principle:**

> **The school owns the structure of the school day; the teacher owns what they
> teach within that structure.**

The school (organization) owns *when* things happen — bell times, the calendar, the
shared course catalog, branding defaults, membership. The teacher owns *what happens
in their classroom within that structure* — their class sections, their lessons,
their resources, their preferences, and their own presentation choices layered on
top of the organization's defaults. Every ownership call in §§2–7 reduces to this
sentence.

**Decisions locked at architecture review** (restated fully, once, in §12):

- **Branding:** organization branding is the default; a teacher may override their
  own watermark/appearance; a future admin-controlled lock is supportable but not
  required now.
- **Course catalog:** OHHS gets an organization-owned catalog, bootstrapped before
  an admin portal exists; teachers may also create their own custom courses.
- **Master Calendar:** the existing OHHS calendar becomes the canonical organization
  calendar; new teachers inherit it; conflicting local calendars are reconciled
  explicitly, never merged or overwritten silently.
- **Google Drive:** per-user redesign is explicitly out of scope for the V2
  foundation; today's anonymous cookie-based integration is untouched; multi-user
  Drive is a later, separately scoped milestone.
- **Realtime:** not required for V2; Present Mode is not architected around live
  admin changes; organization configuration refreshes at safe boundaries (page load,
  navigation, session start).
- **Repository architecture:** `DataRepository` is not decomposed during the V2
  foundation. No speculative aggregate-repository abstraction is part of this
  architecture (§8).
- **`TeacherPeriodAssignment`:** approved as designed — the bridge that lets a
  teacher attach class sections to an organization schedule without cloning it.
- **Lesson model:** the ability to build a lesson once for a course and use it
  across multiple class sections must be preserved; Falcon Deck does not become an
  LMS or a lesson-version-control system; the exact mechanism is deferred to
  `V2_DATABASE_SCHEMA.md` for explicit scrutiny.

---

## 1. Current State

Factual findings from direct inspection of the repository:

- **Persistence seam.** `DataRepository` (`lib/data/types.ts`) is the whole
  interface: `load()`, `save(data)`, `subscribeToExternalChanges(onChange)`.
  Everything above it — the reducer, every screen — only ever talks to this
  interface. Code comments already anticipate this exact task (`lib/data/types.ts`:
  *"A future `SupabaseDataRepository` can implement this same interface without any
  changes to the store or UI that consume it."*).
- **`localStorage` key/model.** `LocalStorageDataRepository`
  (`lib/data/localStorageRepository.ts`) is the only production implementation. It
  reads/writes one JSON blob under one key, `falcon-deck:app-data:v1`, containing
  the entire `AppData` object — courses, class sections, schedules, lessons, library
  resources, teacher preferences, and the (optional) school calendar, all flat, with
  no owner id anywhere. It uses the browser's native `storage` event for cross-tab
  sync. Grepping the source tree, this is the only production read/write site;
  `scripts/verify-resources.ts` asserts as a standing regression test that no other
  source file references `localStorage` directly. Notably,
  `classroomExperienceSettings.customWatermarkDataUrl` stores a base64 `data:` URL
  of a teacher-uploaded image inline in this same blob — the single largest thing in
  it, and a real quota-exceeded risk the code already defends against.
  `AppData` is single-tenant, single-user by construction: Falcon Deck has exactly
  one implicit "tenant" today — whoever's browser it's running in.
- **`AppDataProvider`.** (`lib/store/AppDataProvider.tsx`) wires a repository into
  React: a pure reducer (`lib/store/reducer.ts`, `appDataReducer`) holds state in
  memory, and a `useEffect` persists the whole state via `repository.save()` on
  every change. The reducer has zero knowledge of `localStorage` and is
  unit-testable in isolation — which is exactly what `scripts/verify-*.ts` relies
  on.
- **Schedule engine.** `lib/schedule/*` — pure functions (`getCurrentBlock`,
  `getRemainingTime`, `resolveBlockOverride`, `resolveTeacherSchedule`, etc.),
  timezone `America/Detroit`, operating on a plain `BellSchedule` with no ownership
  concept. `ScheduleBlock.classSectionId` and `ScheduleBlockOverride.classSectionId`
  currently bake a specific teacher's class-section assignment directly into the
  same object that holds the school's shared bell times — a teacher who wants the
  shared `OHHS_REGULAR` preset must `duplicateSchedule` it into a private, editable
  copy first, so every teacher who adopts the same org schedule ends up owning a
  full private copy of its times/blocks just to attach their own sections. This is
  the gap `TeacherPeriodAssignment` (§2) closes.
- **Calendar.** `SchoolYearCalendar`/`SchoolCalendarException`
  (`types/calendar.ts`) — an exception-overlay model (no-school/no-students/
  special-bell days over an implicit "regular day" default), resolved by
  `resolveSchoolDate` (`lib/calendar/resolveSchoolDate.ts`). Explicitly school-wide
  by definition, but currently stored as one field (`schoolCalendar`) inside one
  teacher's `AppData` — each teacher who imports a Master Calendar owns a separate
  copy.
- **Present Mode.** `LivePresentScreen` and related components resolve the current
  schedule state and render the classroom/transition/prep/no-school screens; nothing
  in Present Mode has any organization or multi-user concept today.
- **Demo Mode.** `DemoDataRepository` (`lib/data/demoModeRepository.ts`) is a
  second, in-memory-only `DataRepository` implementation used exclusively by
  `/demo`. It never touches `localStorage` and is completely isolated from real
  data; a page reload discards it.
- **Google Drive, current behavior.** `lib/resources/googleDrive/session.ts` stores
  the OAuth access/refresh token as an AES-256-GCM-encrypted, HttpOnly/Secure
  cookie, server-side only, keyed by a single server secret
  (`FALCON_DECK_SESSION_SECRET`). There is no per-user binding at all today — one
  browser, one implicit session.

---

## 2. Target Domain Model

**2.1 `User` / Profile**
Authenticated identity (Supabase Auth). Platform-scoped — spans organizations.
Owns all teacher-scoped data transitively through membership.

**2.2 `Organization`**
A school (e.g. Ogemaw Heights High School). The tenant boundary. Has many
`OrganizationMembership`, catalog `Course`s, org `BellSchedule`s, a
`SchoolYearCalendar`, and one `OrganizationSettings`.

**2.3 `OrganizationMembership`**
Join of `User` ↔ `Organization`, carrying a `role` (`"teacher" | "admin"`). Every
teacher-scoped entity below is scoped through this row's `organizationId` +
`userId`, not `userId` alone — a teacher's data always lives inside a specific
school.

**2.4 `OrganizationSettings` (branding)**
One row per `Organization`. School-level Present Mode defaults — palette, watermark
image, display name. Organization branding is the default every teacher's Present
Mode renders with; a teacher's personal `ClassroomExperienceSettings` (2.11) may
supply an override on top of it. Reserves a `brandingLocked` boolean for a future
admin capability to disable teacher overrides — not enforced or exposed in the V2
foundation.

**2.5 `Course` (catalog and custom)**
A subject/offering (e.g. "Algebra 1"). Dual-mode, discriminated by `ownerType`: an
org-catalog `Course` (`ownerType: "organization"`) is admin-managed and selectable
by every teacher in the org; a custom `Course` (`ownerType: "teacher"`) is private
to the teacher who created it. One type, one table, no duplicate schemas —
Course and ClassSection remain distinct: `Course` is the subject (e.g. "Geometry");
`ClassSection` (2.9) is a specific teacher's scheduled meeting of it (e.g. "2nd Hour
Geometry"). Multiple `ClassSection`s, across multiple teachers, may reference the
same `Course`.

**2.6 `BellSchedule` / `ScheduleBlock` / `ScheduleBlockOverride`**
A `BellSchedule` is an ordered list of `ScheduleBlock`s, each optionally carrying
weekday `ScheduleBlockOverride`s. Dual-mode, discriminated by `ownerType`, same
pattern as `Course`: an org-owned `BellSchedule` is the school's canonical,
admin-managed bell times (e.g. `OHHS_REGULAR`), shared read-only by every teacher; a
teacher-owned `BellSchedule` is what a teacher builds or duplicates for themselves,
and remains fully supported when their school hasn't configured a shared schedule
yet. `ScheduleBlock`/`ScheduleBlockOverride` inherit their parent schedule's
ownership. On an org-owned schedule, `classSectionId` is dropped from the block
entirely (the org doesn't know which teacher is in which room) — that assignment
moves to `TeacherPeriodAssignment` (2.8). A teacher-owned schedule keeps
`classSectionId` embedded on the block directly, unchanged from today. The current
schedule engine (`lib/schedule/*`) is untouched by any of this.

**2.7 `SchoolYearCalendar` / `SchoolCalendarException`**
The Master Calendar exception-overlay model (no-school / no-students / special-bell
days), unchanged in shape. Organization-scoped: a school has a canonical calendar,
shared by every teacher, rather than each teacher owning a separate imported copy.
For OHHS in V2, one canonical calendar per school year is sufficient; nothing here
precludes a school having more than one calendar row over time as long as exactly
one resolves for any given date. `SchoolCalendarException.bellScheduleId` points at
an org-owned `BellSchedule`. `resolveSchoolDate` is untouched.

**2.8 `TeacherPeriodAssignment`** *(new entity)*
The bridge that lets a teacher attach their own `ClassSection`s to an org-owned,
shared `BellSchedule`'s blocks **without cloning the schedule**. One row per
(teacher, org schedule block, optional weekday-override) → `ClassSectionId` — the
organization schedule supplies the periods; this table supplies which of a
teacher's sections meets in which period. Always teacher-scoped, always subordinate
to the org-owned block it references. The current-period engine gains one small
resolution step (merge assignments onto blocks before override-resolution); its
core functions don't otherwise change.

**2.9 `ClassSection`**
A specific, schedulable meeting of a `Course` (e.g. "Geometry — 2nd Hour"), unchanged
in shape. Always teacher-owned — never shared between teachers, even for a
catalog-sourced course. References `courseId` (catalog or custom); referenced by
`TeacherPeriodAssignment`, `DailyLesson`, `ClassPresentationSettings`.

**2.10 `TeacherSchedulePreferences`**
Teacher-scoped, currently just `lunchWave`. Already correctly modeled today; V2 adds
explicit scoping columns only.

**2.11 `ClassroomExperienceSettings`**
Teacher-scoped personal Present Mode preferences — countdown message, end-of-day
behavior, Clean Screen defaults, transition toggles — plus an optional personal
watermark override (`customWatermarkDataUrl`/`watermarkOpacity`). When unset,
Present Mode renders the organization's branding (2.4); when set, the teacher's own
value wins. This is the one field in this type layered on top of an org default
rather than fully independent.

**2.12 `ClassPresentationSettings`** (arrival routines)
Teacher-scoped, per-`ClassSection` arrival checklist, unchanged in shape.

**2.13 `DailyLesson`** (+ embedded `AgendaItem`, `LessonResource`, `Announcement`)
Teacher-scoped, one per (date, `ClassSection`), unchanged in shape.
`LessonResource.libraryResourceId` optionally traces back to a `LibraryResource` but
is always a standalone snapshot. The ability to build a lesson once for a `Course`
and reuse it across a teacher's multiple `ClassSection`s of that course must be
preserved without turning this into an LMS or a lesson-version-control system —
today's model is strictly per-section, so the exact reuse mechanism (e.g. a
"copy to another section" action versus a shared source record) is an open question
for `V2_DATABASE_SCHEMA.md`, not resolved here.

**2.14 `LibraryResource`**
Teacher-scoped reusable resource library, unchanged in shape.

**Google Drive is deliberately not modeled as a foundation entity.** Per-user
`GoogleDriveConnection` is a real, designed concept but is explicitly deferred — see
§12. Today's anonymous, cookie-based Drive integration stays exactly as-is through
every milestone in §11 before the dedicated later Drive milestone.

**Onboarding state** is intentionally not a persisted entity. "How far along is this
teacher's setup" is derived live from real data (`getOnboardingStatus`) on every
read, never a separately-persisted flag — see §9.

---

## 3. Entity Relationship Model

```
Organization
 ├─ OrganizationMembership (one per User)
 ├─ OrganizationSettings (1:1 — branding defaults)
 ├─ Course            (ownerType = organization; the catalog)
 ├─ BellSchedule       (ownerType = organization)
 │   ├─ ScheduleBlock
 │   │   └─ ScheduleBlockOverride (per weekday)
 └─ SchoolYearCalendar
     └─ SchoolCalendarException (may reference an org BellSchedule)

OrganizationMembership (= one teacher, within one Organization)
 ├─ Course             (ownerType = teacher; custom courses)
 ├─ BellSchedule        (ownerType = teacher; fully custom/duplicated schedules)
 │   ├─ ScheduleBlock (classSectionId embedded directly — teacher-owned only)
 │   │   └─ ScheduleBlockOverride
 ├─ TeacherPeriodAssignment → org ScheduleBlock (+ optional weekday) → ClassSection
 ├─ ClassSection → Course (catalog or custom)
 │   ├─ DailyLesson (one per date)
 │   │   └─ (embedded AgendaItem / LessonResource / Announcement)
 │   └─ ClassPresentationSettings (arrival routine)
 ├─ ClassroomExperienceSettings (1:1 — personal Present Mode prefs + optional
 │    branding override)
 ├─ TeacherSchedulePreferences (1:1 — e.g. lunch wave)
 └─ LibraryResource (reusable resource library)
```

`TeacherPeriodAssignment` is the only teacher-owned row that points directly at an
org-owned `ScheduleBlock` — it exists specifically so a teacher never has to fork
the shared schedule just to say "my Geometry section meets Period 2." `Course` and
`BellSchedule` each appear under both `Organization` and `OrganizationMembership`
because both are dual-owned entities: one table, discriminated by an ownership
column, not two separate schemas.

---

## 4. Ownership Model

| Data | Owner | Anchor entity |
|---|---|---|
| Auth identity | Platform | `User` |
| School itself, admin roles | Organization | `Organization`, `OrganizationMembership` |
| Branding defaults | Organization (teacher may override) | `OrganizationSettings`; override on `ClassroomExperienceSettings` |
| Course catalog entries | Organization | `Course` (`ownerType=organization`) |
| Canonical bell schedule(s) | Organization | `BellSchedule` (`ownerType=organization`) |
| Weekday content overrides on org schedule | Organization | `ScheduleBlockOverride` |
| Master Calendar / exceptions | Organization | `SchoolYearCalendar` |
| Custom course | Teacher | `Course` (`ownerType=teacher`) |
| Class section | Teacher (always) | `ClassSection` |
| Which section meets which period | Teacher | `TeacherPeriodAssignment` |
| Fully custom/duplicated bell schedule | Teacher | `BellSchedule` (`ownerType=teacher`) |
| Lessons, agenda, resources, announcements | Teacher (via class section) | `DailyLesson` |
| Resource library | Teacher | `LibraryResource` |
| Arrival routines | Teacher (via class section) | `ClassPresentationSettings` |
| Personal Present Mode preferences (non-branding) | Teacher | `ClassroomExperienceSettings` |
| Lunch wave, other per-teacher schedule prefs | Teacher | `TeacherSchedulePreferences` |
| Google Drive connection | *(deferred — not part of the V2 foundation)* | — |

---

## 5. Multi-Tenancy and RLS Model

**Core boundary:** every table (except platform-level `users`) carries an explicit
`organization_id` column. Teacher-scoped tables additionally carry `owner_user_id`.
Neither is inferred from a join at query time — both are denormalized onto the row
itself, so RLS policies stay simple, single-table checks.

- `organization_id` answers *"which school does this belong to"* — no row is ever
  readable across organizations.
- `owner_user_id` (teacher-scoped tables only) answers *"which specific teacher,
  within that school, does this belong to"* — private-by-default within the tenant
  too; membership in a school does not imply visibility into another teacher's
  classroom.

**Conceptual RLS shape** (no SQL — policy intent only):

- **Org-scoped, admin-writable, member-readable:** `organizations`,
  `organization_settings`, `courses`/`bell_schedules`/`schedule_blocks`/
  `schedule_block_overrides` where owned by the organization, `school_year_calendars`,
  `school_calendar_exceptions`. `SELECT` allowed to any user with an active
  membership in that organization; `INSERT`/`UPDATE`/`DELETE` restricted to
  `role = 'admin'` members. Until an admin UI exists, these tables are seeded/edited
  via a trusted process (migration script, service-role tooling) rather than blocked
  on the policy.
- **Teacher-scoped, strictly owner-only:** `class_sections`,
  `teacher_period_assignments`, `daily_lessons`, `library_resources`,
  `class_presentation_settings`, `classroom_experience_settings`,
  `teacher_schedule_preferences`, and `courses`/`bell_schedules` owned by a teacher.
  All operations require `owner_user_id = auth.uid()` — no exceptions for
  same-organization teachers or, initially, even admins. A future admin capability
  needing read access to teacher data is a deliberate, separate policy grant to
  design later, not an implicit consequence of `role = 'admin'`.
- **`organization_memberships`:** a user always reads their own row(s); admins
  read/write all rows within their own organization; never across organizations.
- **Platform-scoped** (`auth.users`): standard Supabase Auth behavior.

Organization configuration does not need to propagate live to an open Present Mode
session — it is read at safe refresh boundaries (page load, navigation, session
start) through the (unchanged, §8) repository interface, not a subscription.
Today's `subscribeToExternalChanges` remains same-browser, same-user cross-tab sync
only.

---

## 6. Current-to-V2 Mapping

| Current (`AppData` field / type) | V2 entity | Migration |
|---|---|---|
| `courses` (`Course[]`) | Teacher's own `Course` rows (`ownerType: "teacher"`) | Migrates unchanged; the OHHS catalog (`ownerType: "organization"`) is bootstrapped separately at org-setup time, never derived from any migrating teacher's local courses |
| `classSections` (`ClassSection[]`) | `ClassSection` | Migrates unchanged, gains `organizationId`/`ownerUserId` |
| `schedules` where `source: "built-in"` (e.g. a local OHHS preset) | Reconciled against the canonical organization-owned `BellSchedule`, which is seeded separately | The local preset is never promoted into organization ownership. Teacher migration never creates, promotes, or overwrites organization schedule data. The teacher's preset is reconciled against the canonical schedule, and its teacher-specific `classSectionId` assignments are extracted into `TeacherPeriodAssignment` rows. |
| `schedules` where `source: "custom"`/`"imported"` | `BellSchedule` (`ownerType: "teacher"`) | Migrates unchanged |
| `ScheduleBlock.classSectionId` on an org schedule | `TeacherPeriodAssignment` | Needs transformation — extracted into a per-teacher join row; the one real structural change in the model |
| `ScheduleBlock.classSectionId` on a teacher schedule | Stays on `ScheduleBlock` | Migrates unchanged |
| `schoolCalendar` | `SchoolYearCalendar` (organization-owned) | Ownership changes — becomes a shared org singleton seeded from OHHS's existing calendar; a migrating teacher's conflicting local calendar requires explicit reconciliation, never automatic merge (§7) |
| `lessons`, `libraryResources`, `classPresentationSettings` | Same types | Migrate unchanged, gain scoping columns |
| `classroomExperienceSettings.customWatermarkDataUrl` / `.watermarkOpacity` | Teacher's personal override on `ClassroomExperienceSettings` | Migrates unchanged as the teacher's own override — never promoted to `OrganizationSettings`, which is seeded separately |
| `classroomExperienceSettings` (remaining fields) | `ClassroomExperienceSettings` | Migrates unchanged |
| `teacherSchedulePreferences` | `TeacherSchedulePreferences` | Migrates unchanged — already correctly modeled |
| Drive OAuth cookie | *(not migrated)* | Stays exactly as-is (anonymous, cookie-based) through the V2 foundation; per-user redesign is a later dedicated milestone |
| Onboarding status (`getOnboardingStatus`, never persisted) | *(stays derived, not a table)* | No change — reads through the unchanged `DataRepository` interface |
| Demo Mode | Same concept, same interface | Not migrated to Supabase — remains available as the anonymous sandbox implementation of `DataRepository` during V2. Whether it remains product-facing indefinitely is an open product decision (§13). |
| `localStorage` key `falcon-deck:app-data:v1` | *(migration source only)* | Obsolete as source of truth once migration completes; preserved read-only until then |

No entity in the current model is fully obsolete. The one place the shape genuinely
changes (not just gains columns) is `classSectionId` on org-owned schedule blocks,
extracted into `TeacherPeriodAssignment`.

---

## 7. Migration Strategy

Goal: every existing user's local Falcon Deck data survives the move to Supabase,
with a real backup and a way to recover if anything looks wrong.

1. **Detection.** On first authenticated app load, check
   `localStorage.getItem("falcon-deck:app-data:v1")`. Non-empty ⇒ offer "Import your
   existing Falcon Deck data."
2. **Backup, before anything is written.** Leave the original `localStorage` key
   completely untouched (never deleted/modified by migration, only read). Snapshot
   it under a new versioned key so a retry or a concurrent tab can't shift the
   source data. Offer a one-click downloadable `.json` backup independent of both
   the browser and the database.
3. **Organization resolution.** Local data has no `organizationId`; the teacher
   completes onboarding's select/join-school step first — migration cannot run
   before this.
4. **One-time, idempotent migration** through `SupabaseDataRepository` (the
   existing `DataRepository` interface, §8), preserving existing ids as primary
   keys so a retry after partial failure upserts rather than duplicates:
   - Splits organization- vs. teacher-owned rows per §6.
   - **Schedules: reconcile against organization data; never create, promote, or
     overwrite it.** Canonical organization bell schedules already exist before
     teacher migration. If the teacher used a matching OHHS preset, reconcile the
     local preset against the canonical organization schedule and extract the
     teacher-specific `classSectionId` assignments into `TeacherPeriodAssignment`
     rows. Genuinely teacher-created/custom schedules remain teacher-owned and
     migrate as teacher data.
   - Migrates existing watermark/opacity as the teacher's personal
     `ClassroomExperienceSettings` override — never automatically promoted to
     `OrganizationSettings`, which is seeded separately at org-setup time.
   - Migrates existing courses as the teacher's own `ownerType: "teacher"` rows —
     never automatically promoted into the organization catalog.
   - **Calendar: compare-then-reconcile, never merge.** The organization's
     canonical calendar already exists before any teacher migrates. If a migrating
     teacher's local calendar is absent or an exact match, nothing is written. If it
     differs, migration surfaces the difference for explicit reconciliation and
     proceeds with the rest of that teacher's migration regardless of how the
     calendar conflict is resolved — a calendar conflict must never block migration
     of unrelated classes, lessons, or resources.
   - Writes a `migrated_at` marker as the single source of truth for "has this
     user already migrated," making the whole operation safe to retry.
5. **Validation.** Read back through the same `DataRepository` interface and
   compare record counts and referential integrity (every `ClassSection.courseId`
   resolves, every `DailyLesson.classSectionId` resolves, the default `BellSchedule`
   is still marked default, every `TeacherPeriodAssignment` points at a real
   `ClassSection`) against the pre-migration snapshot. Surface a clear pass/fail
   summary — never silently trust the write.
6. **Rollback/recovery.** On validation failure, treat the migration as
   not-committed (roll back the writes, or simply never set `migrated_at` so the app
   keeps reading local data and the teacher can retry). The original `localStorage`
   copy remains the durable rollback source, never auto-cleared. The downloaded
   `.json` backup is the last-resort recovery path, independent of both the browser
   and Supabase.

---

## 8. Repository / Data Access Architecture

Today's `DataRepository` (`lib/data/types.ts`) provides the persistence abstraction used by Falcon Deck.

**Locked decision:** `DataRepository` is not decomposed during the V2 foundation.

- `SupabaseDataRepository` will implement the existing `DataRepository` interface.
- `LocalStorageDataRepository` will remain available for the existing local-data path.
- `DemoDataRepository` will remain available for Demo Mode.
- The appropriate repository implementation will be selected based on application/auth/demo context.
- `AppDataProvider` and consuming UI components should remain insulated from the persistence implementation.
- Decomposition into narrower aggregate repositories is explicitly deferred. It will be considered only if concrete Supabase query, write, concurrency, or performance requirements demonstrate that the existing interface is inadequate.

No speculative aggregate repositories are part of the approved V2 foundation architecture.

---

## 9. Onboarding Support

**"Classroom ready":** Present Mode can resolve a real, non-empty block for the
current or next period, tied to one of the teacher's own `ClassSection`s. This
requires: at least one `OrganizationMembership`; at least one `ClassSection`; and at
least one working period → section mapping (a `TeacherPeriodAssignment` against an
org schedule, or a teacher-owned schedule with `classSectionId` set directly).
Notably, this does not require a `DailyLesson` — Present Mode already renders
correctly with empty agenda/target/resources/announcements placeholders.

**Primary metric:** time from signup to "I can teach tomorrow." When a teacher's
school is already configured, onboarding is select-and-associate (choose courses
from the catalog or create custom ones, choose periods from the organization
schedule) rather than manual recreation — generate/prefill first, edit second —
targeting roughly **3–5 minutes**. A teacher at a school with no configuration yet
still reaches a working classroom screen via the slower, fully-manual Schedule Setup
path, targeted at **under 10 minutes** worst case.

Onboarding status remains **derived live** from real data
(`getOnboardingStatus`), never a separately-persisted completion flag that can
drift — only its inputs change, as organization-scoped data becomes queryable
through the unchanged `DataRepository` interface (§8).

---

## 10. Future Admin Support

What the schema needs now, so an admin portal can be added later without a
redesign (no admin UI is being built here):

- `role` on `OrganizationMembership` from day one, even though nothing reads it for
  UI purposes yet.
- `organization_id` as an explicit, denormalized column on every org-scoped table.
- `OrganizationSettings` as its own row per organization, giving a future branding
  admin screen an obvious table, and already carrying the `brandingLocked` field a
  future lock capability needs without a schema change.
- The `ownerType` discriminator on `Course`/`BellSchedule`, letting a future
  "manage catalog"/"manage schedules" admin screen see only what the school owns.
- Universal `createdAt`/`updatedAt` timestamps on every new table, cheap now,
  expensive to retrofit later for an eventual admin audit view.
- No new roles beyond `teacher`/`admin`, no fine-grained permission system, and no
  admin-specific tables beyond what's listed above.

Architecture supports future organization admins managing the master calendar, bell
schedules, branding, the course catalog, and memberships — the admin UI itself
comes later and does not block initial teacher onboarding.

---

## 11. Implementation Milestones

1. **Architecture & data model** — this document.
2. **Ownership fields + `TeacherPeriodAssignment`, still on `localStorage`.** Add
   `ownerType`/`organizationId`/`ownerUserId` (defaulting to an implicit single
   local org/user, so behavior is unchanged); extract `TeacherPeriodAssignment` from
   embedded `classSectionId`. `DataRepository` remains unchanged. Extend the
   `verify-*.ts` suite to cover the new shape. No user-visible change; fully
   reversible.
3. **Database schema design and Supabase migrations** — built against the
   now-accurate TypeScript shapes from step 2, developed and tested without
   touching the running app.
4. **Authentication** (Supabase Auth) — can ship behind a flag while the
   local/`localStorage` path keeps serving existing users unchanged.
5. **Organizations and memberships** — seed OHHS as the one real organization.
6. **`SupabaseDataRepository` + migration from `localStorage`** (§7) — now that
   auth and a real organization exist, an existing teacher's browser data has
   somewhere real to go.
7. **Organization-owned school configuration** — OHHS's real bell schedule, Master
   Calendar, branding defaults, and course catalog, seeded as canonical org data
   (not fictional placeholder data).
8. **Fast teacher onboarding** (§9) — now backed by real org catalog/schedule data,
   so onboarding can select/prefill rather than manual entry.
9. **Lesson/content behavior across multiple class sections** — the reuse mechanism
   flagged in §2.13/§12, preserving simple "build once, use across sections" without
   becoming an LMS.
10. **Admin portal** — deliberately after teacher-facing capability is solid; §10
    is what keeps this from requiring a schema redesign.
11. **Multi-user Google Drive redesign** — separately scoped and deliberately last;
    today's anonymous cookie-based integration is untouched by every milestone
    before this one.

---

## 12. Resolved Architecture Decisions

1. **Branding.** Organization branding is the default; a teacher may override their
   own Present Mode watermark/appearance; a future admin-controlled lock may be
   added later but is not required now.
2. **`TeacherPeriodAssignment`.** Approved as designed — assigning a section to a
   period on an org-owned schedule creates a `TeacherPeriodAssignment` row rather
   than editing a `ScheduleBlock` directly. The resulting UX distinction (assign-only
   on an org-provided schedule vs. fully editable on a teacher-owned one) still
   needs implementation-time design; the data-model approach itself is approved.
3. **Org and teacher-owned schedules coexist indefinitely.** A school with no
   configured bell schedule must not block a teacher from building their own; both
   `BellSchedule` ownership paths are permanent, not transitional.
4. **Course-catalog bootstrapping.** OHHS is bootstrapped with organization-owned
   catalog data before an admin portal exists; teachers may also create teacher-owned
   custom courses.
5. **Master Calendar reconciliation.** The existing OHHS calendar becomes the
   canonical organization calendar; new teachers inherit it; a conflicting
   preexisting local calendar requires explicit reconciliation, never automatic
   merging, and never blocks migration of unrelated teacher data. The
   reconciliation *mechanism* (UI, who resolves it) is not yet designed — only the
   policy that it must be explicit is locked.
6. **Google Drive redesign is deferred.** Not part of the initial V2 foundation;
   today's integration stays isolated and unchanged; multi-user Drive is a later,
   dedicated milestone.
7. **Realtime/collaboration scope.** Not required for V2; Present Mode is not
   architected around live admin changes; configuration refreshes at safe
   boundaries instead.
8. **Repository architecture.** `DataRepository` is not decomposed during the V2
   foundation; no speculative aggregate-repository abstraction is part of this
   architecture.

---

## 13. Genuinely Open Risks / Decisions

1. **Demo Mode's long-term product-facing role.** Demo Mode remains available as
   an anonymous sandbox during V2. Whether it remains product-facing indefinitely
   or retires once real signup exists is an open product decision.
2. **Teacher deletion/offboarding/data-retention policy.** What happens to a
   teacher's class sections/lessons if their `OrganizationMembership` is removed?
   Not urgent for V2's first cut, but worth deciding before RLS/cascade behavior is
   finalized.
3. **Exact lesson section-customization model**, pending database-schema review
   (§2.13) — how "build once for a course, use across sections" is actually
   represented without becoming a content-versioning system.
4. **Exact calendar-conflict reconciliation UI/actor** — who resolves a conflicting
   local calendar during migration (the teacher, an admin, or both), and what that
   flow looks like. The *policy* (explicit reconciliation, never silent merge) is
   locked; the *mechanism* is not.

---

*This document describes intended architecture only. No tables, policies, or
authentication have been created.*
