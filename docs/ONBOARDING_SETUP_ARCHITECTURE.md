# Streamlined Onboarding — Architecture Decisions

**Status:** persistence foundation implemented and tested in isolation. The two
migrations below are **not applied to any Supabase project**. No route, screen, or
redirect has changed; no existing account behaves differently.

**Goal of the milestone:** a new teacher goes from signup to a saved, usable
classroom display in one continuous flow —
school → teaching day → first lesson and preview → present.

**This document covers** the decisions for that flow's persistence and the
foundation built on them. The screens are later, separately scoped work (§11).

---

## 1. Summary

| Concern | Decision |
|---|---|
| Where in-progress setup lives | A **setup draft**, one per membership, in its own table — never in `AppData` |
| How a draft is saved | Whole-draft autosave guarded by a **revision** number; a stale write is refused, not merged |
| How setup is committed | One database function, `complete_setup`, in **one transaction** |
| How retries are safe | A fixed **operation id** per draft plus a completion ledger; a repeat returns the stored result |
| How the app sees the result | The flow runs **outside** the operational provider; finishing mounts a fresh one that loads from the database |
| Who enters the new flow | New cloud accounts with no classes and no active schedule; everyone else is unchanged |

Files:

- `supabase/migrations/20261010210000_onboarding_setup_stage_a_schema.sql`
- `supabase/migrations/20261010210100_onboarding_setup_stage_b_rpcs.sql`
- `types/setupDraft.ts` — the draft's shape
- `lib/onboarding/setupDraft.ts` — pure logic: validation, shared-schedule snapshot, preview projection
- `lib/onboarding/setupRepository.ts` — the `SetupRepository` interface and response parsing
- `lib/data/supabaseSetupRepository.ts` — its RPC-backed implementation
- `lib/onboarding/setupDraftSession.ts` — autosave / conflict / completion state machine
- `lib/onboarding/setupEntry.ts` — the entry rule

---

## 2. Why the existing save path cannot do this

`SupabaseDataRepository.save()` compares two in-memory snapshots and issues one
upsert or delete per changed table, in sequence. A single reducer dispatch
therefore becomes several independent network writes. If the third fails, the first
two stay written. That is acceptable for editing one lesson; it is not acceptable
for "create my courses, classes, schedule, preferences and first lesson", where a
partial result is a broken account.

It also has no notion of a request identity, so a retry after a lost response
cannot be told apart from a new request.

Setup completion therefore does not go through `DataRepository` at all. The general
save engine is unchanged by this work.

---

## 3. Setup drafts are separate from operational data

A draft is everything the teacher has entered so far. It is stored in
`setup_drafts` (primary key `owner_membership_id` — at most one per membership) and
is invisible to `AppData`, `fetchAppData`, Present Mode, and every existing screen.
Nothing a teacher types during setup becomes a course, class, schedule or lesson
until completion commits it.

Consequences:

- An abandoned or half-finished setup leaves no operational rows behind.
- `getOnboardingStatus` stays exactly as it is: derived from real data, never a
  stored flag. `docs/V2_ARCHITECTURE.md` §2 says onboarding state is not persisted;
  that remains true of *readiness*. What is now persisted is uncommitted input and
  a record that a specific commit happened — neither is a readiness flag.
- Drafts are scoped to a membership, not a user or a browser, so setup resumes on
  another device.

**Access.** Both new tables have RLS enabled, **no policies, and no table
privileges** for `anon` or `authenticated`. They are reachable only through three
`SECURITY DEFINER` functions. This is deliberately narrower than the owner-only
policies on operational tables: a revision counter and a stored completion result
are only trustworthy if no client can write them directly.

**Identity.** Each function takes the organization id and resolves the caller's
membership from `auth.uid()` — the same posture as `import_bell_schedule`. No
function accepts a membership id or user id. Owner and organization columns on
every committed row come from that resolved membership, never from the draft.

---

## 4. Autosave, resume, revisions, visible failures

`save_setup_draft(organization, expected_revision, payload)`:

- `expected_revision` null creates the draft (revision 1) and mints its operation id.
- Otherwise the save applies only if the stored revision still equals
  `expected_revision`, and increments it by one.
- A mismatch changes nothing and returns the currently stored draft.

`SetupDraftSession` is one tab's working copy. Its rules:

- One request in flight at a time. Edits made meanwhile collapse into a single
  follow-up save of the latest draft.
- A failed save sets status `save-failed`, keeps the edit, and keeps the draft
  marked unsaved. It is retried on the next edit, on `retrySave()`, or before
  completion. It is never dropped silently.
- A conflict pauses autosave and exposes the stored draft. The caller chooses
  `use-server` or `keep-mine`. Nothing is overwritten without that choice.
- Resume: `get_setup_state` returns the stored draft, revision and operation id; a
  new session starts from them.

Statuses the UI must render: `idle`, `saving`, `saved`, `save-failed`, `conflict`,
`ineligible`, `completing`, `completion-rejected`, `completion-unconfirmed`,
`completed`.

---

## 5. Stable ids and the operation id

Every id in a draft (course, class, schedule, block, assignment, lesson) is
generated once on the client when the item is added, and then lives in the saved
draft. Retrying completion from any tab submits the same ids.

The **operation id** is generated by the database when the draft is created,
stored on the draft row, and never changes. `complete_setup` is keyed on it.

---

## 6. Atomic completion

`complete_setup(organization, operation_id, expected_revision)` commits the
**stored** draft. The payload is read from `setup_drafts`; the caller does not
resend it. What is committed is therefore exactly what was last saved at the
revision the caller names.

In order, inside one function call (one transaction):

1. Take a per-membership advisory lock.
2. If this operation id is already in `setup_completions`, return its stored result.
3. Check the draft exists, has this operation id, and is at `expected_revision`.
4. Validate everything (§6.1). Nothing has been written yet.
5. Insert teacher-owned `courses`, then `class_sections`.
6. Either insert a private `bell_schedules` row and its `schedule_blocks`, **or**
   insert `teacher_period_assignments` onto a shared schedule.
7. Upsert `teacher_schedule_preferences` (lunch wave, active schedule).
8. Insert the first `lessons` row and its `lesson_class_sections` row, if present.
9. Insert the `setup_completions` row and delete the draft.

Any error at any step rolls back every step. The draft is deleted in the same
transaction that commits, so a draft exists exactly as long as its completion has
not committed.

### 6.1 Server-side validation

- Every class names a course that is in the draft, in the organization catalog, or
  owned by the caller. (This is the catalog-or-own-course rule that
  `docs/V2_DATABASE_SCHEMA.md` §2.9 leaves to the write path.)
- A private schedule follows `import_bell_schedule`'s rules: named blocks, valid
  kinds, end after start, no overlaps, positions assigned from start time. Block
  ids are stored in the same scoped form (`scopedCloudId`).
- At least one class is placed in a period.
- A first lesson, if present, belongs to a class in the draft.

A prepared first lesson is **required by the client validator**
(`validateSetupDraft`) and **optional in the database function**. Requiring it is a
product rule; the function enforces integrity only.

### 6.2 Shared schedules are never written

Choosing the school's schedule writes `teacher_period_assignments` (base rows only)
and the caller's own preferences. It never inserts, updates or deletes
`bell_schedules`, `schedule_blocks` or `schedule_block_overrides`. The test suite
compares the shared schedule's rows before and after, `updated_at` included.

"Build my own schedule" creates a `owner_type = 'teacher'` schedule **inside the
teacher's resolved organization**. Organization membership is still required before
setup begins. Setting up without a school is a separate membership-architecture
question and is not introduced here.

---

## 7. Duplicates and ambiguous results

| Situation | Outcome |
|---|---|
| Completion submitted twice | Second call returns `completed, replayed: true` with the stored result; writes nothing |
| Commit succeeded, response lost, teacher retries | Same as above |
| Commit succeeded, response lost, teacher reloads | `get_setup_state` returns `completed` |
| A different operation id for a completed membership | `conflict: already-completed`; `setup_completions` is unique per membership |
| Save applied, response lost, next save sent | Server reports a revision conflict; the session recognises the stored payload as its own unconfirmed write and adopts its revision without showing a conflict |

The repository reports every failed call as either `rejected` (the server answered
and refused; nothing applied) or `unknown` (no usable answer). After `unknown` on
completion the session's status is `completion-unconfirmed`, and the only action
offered should be to try again — which asks about the same operation.

---

## 8. Concurrent tabs and a changed shared schedule

**Two tabs on the same draft.** The second tab's save names an old revision and is
refused with the stored draft. Completing from a stale revision is refused the same
way. After one tab completes, any other tab's next save is answered `completed`,
and a new draft cannot be created.

**A shared schedule that changed.** When a teacher picks a shared schedule the
draft records that schedule's periods as shown (id, label, kind, start, end, in
order). At completion the function compares this with the live schedule. Any
difference — a moved period, an added or removed one, the schedule deleted or
marked as needing configuration — returns `conflict: shared-schedule-changed` and
writes nothing. The teacher reviews the new periods, the draft is updated, and the
same operation is submitted again. `hasSharedScheduleChanged` makes the same check
on the client so it can be shown on resume rather than only at the end.

---

## 9. Updating the app after completion

The risk: the operational `AppDataProvider` holds a full snapshot in memory and
its repository holds a baseline. Rows written behind its back are unknown to both,
and a later save from that stale snapshot could overwrite them.

Decisions:

1. **The guided flow is not mounted under `CutoverAppDataProvider`.** It never
   dispatches an `AppData` action, so no operational autosave exists in that tab
   while setup is in progress.
2. **The flow reads reference data read-only** (shared schedules, catalog courses)
   and writes only through `SetupRepository`.
3. **Preview before commit uses `projectSetupDraftToAppData`.** It produces the
   `AppData` the draft will become, to be rendered by the existing Present/Preview
   components under an in-memory, non-persisting provider — the pattern Demo Mode
   already uses. The test suite asserts that a real load after completion equals
   this projection.
4. **On `completed`, navigate to an operational route.** That mounts a new
   `CutoverAppDataProvider`, whose `load()` reads the committed rows and sets the
   repository's baseline from them. There is no in-place merge and nothing to
   reconcile.

---

## 10. Entry: new accounts only

`get_setup_state` reports `not-started` with an eligibility verdict. A membership
is eligible when all hold:

- `account_origin = 'cloud_native'`
- it owns no class sections
- it has no active bell schedule
- it has no completed setup

`deriveSetupEntry(authority, setupState)` turns that into a route decision:

| Account | Entry |
|---|---|
| New cloud account, eligible | guided setup |
| Draft in progress | guided setup (resume) |
| Setup completed | existing app |
| Cloud account that already has classes or an active schedule | existing app |
| Legacy account, migrated | existing app |
| Legacy account, migration pending (`local` authority) | existing app — decided without consulting setup state |
| Setup state unavailable | existing app |

"Existing app" means today's behaviour exactly: `/setup`, `ActiveScheduleGate`,
`MigrationSetupCard`. Nothing in this foundation calls `deriveSetupEntry` yet, so
no account is routed differently until the UI task wires it in.

---

## 11. Unresolved limitations

1. **Real concurrency is not exercised.** The database tests run on PGlite: real
   Postgres, but one connection, and version 18 where production is 17. Duplicate
   submissions are issued back to back. The advisory lock's wait under two
   simultaneous transactions is reasoned about, not observed. Run the database
   suite's scenarios against a disposable Supabase project before applying these
   migrations to production.
2. **No disposable Supabase project exists.** The repo links only the production
   project, and `verify:supabase-migration` runs against it. A Supabase preview
   branch would not work as-is: `20260922000000_organization_memberships_account_origin.sql`
   refuses to apply unless two specific production rows exist. The test harness
   seeds those two rows to get past it.
3. **A stale tab of the general app can still overwrite preferences.** If the
   ordinary app is open in a second tab while setup completes in the first, that
   tab's later edit to lunch wave or active schedule rewrites the whole
   `teacher_schedule_preferences` row from its stale copy. This is the existing
   last-write-wins behaviour of the snapshot save engine, not new, and it cannot
   duplicate or corrupt the completion itself. Closing it needs either a revision
   on that row or cross-tab invalidation — both outside "do not rewrite the save
   engine".
4. **Weekday overrides on a shared schedule are not part of the change check.**
   Only base periods are compared. Assignments are keyed to base blocks, so
   integrity is unaffected, but a teacher is not prompted when only a weekday
   variation changed.
5. **Eligibility is a product rule, set conservatively.** A new teacher who picks a
   schedule on today's `/setup/schedule` screen and then stops becomes ineligible
   and stays on the existing screens.
6. **One completion per membership, and no discard.** There is no "start over" or
   "run setup again" function. A draft can be overwritten but not deleted by the
   client; abandoned drafts do not expire.
7. **Raw database messages can reach `completion-rejected`.** Validation failures
   carry written-for-users messages. An unexpected failure (for example an id
   collision) carries Postgres's own text. The UI should show its own wording for
   anything it does not recognise.
8. **`lib/data/supabase.types.ts` is not regenerated.** As with
   `import_bell_schedule`, the new functions are called through a narrow local
   type rather than by hand-editing the generated file.
9. **Draft size is capped at 256 KB** and drafts carry no uploaded files.

---

## 12. Verification

| Scenario | Where |
|---|---|
| Draft reload / resume | `verify:onboarding-setup-db` §3 |
| Concurrent stale draft update detected | db §4; `verify:onboarding-setup-foundation` §3 |
| Unauthorized access to another membership's draft or setup | db §5, §12 |
| Failure midway through completion rolls back | db §6 |
| Duplicate completion submissions | db §8 |
| Commit succeeds, response lost, retry creates no duplicates | db §9 |
| Shared schedule preserved; changed schedule detected | db §10, §11 |
| Existing cloud and legacy accounts unchanged | db §2, §14; foundation §8, §9; existing `npm run verify` |

Both scripts are part of `npm run verify`. The database script creates an in-memory
database, applies every file in `supabase/migrations` to it, and discards it. It
reads no environment file and opens no network connection.
