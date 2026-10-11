# Streamlined Onboarding — Architecture Decisions

**Status:** persistence foundation implemented and tested in isolation, awaiting
review. The two migrations below are **not applied to any Supabase project**. No
route, screen, or redirect has changed; no existing account behaves differently.
The stale-tab data loss found during review is fixed in the save engine and
covered by regression tests (§9.2); what that fix does not cover is listed there.

**Goal of the milestone:** a new teacher goes from signup to a saved, usable
classroom display in one continuous flow —
school → teaching day → first lesson and preview → present.

**This document covers** the decisions for that flow's persistence and the
foundation built on them. The screens are later, separately scoped work.

---

## 1. Summary

| Concern | Decision |
|---|---|
| Where in-progress setup lives | A **setup draft**, one per membership, in its own table — never in `AppData` |
| How a draft is saved | Whole-draft autosave guarded by a **revision** number; a stale write is refused, not merged |
| How setup is committed | One database function, `complete_setup`, in **one transaction** |
| What may be committed | The same rules on the client and in the database, including a prepared first lesson |
| How retries are safe | A fixed **operation id** per draft plus a completion ledger; a repeat returns the stored result |
| How the app sees the result | The flow runs **outside** the operational provider; finishing mounts a fresh one that loads from the database |
| Who enters the new flow | New cloud accounts that have not built anything yet; everyone else is unchanged |

Files:

- `supabase/migrations/20261010210000_onboarding_setup_stage_a_schema.sql`
- `supabase/migrations/20261010210100_onboarding_setup_stage_b_rpcs.sql`
- `types/setupDraft.ts` — the draft's shape
- `lib/onboarding/setupDraft.ts` — pure logic: validation, shared-schedule snapshot, seed, preview projection
- `lib/onboarding/setupRepository.ts` — the `SetupRepository` interface and response parsing
- `lib/data/supabaseSetupRepository.ts` — its RPC-backed implementation
- `lib/onboarding/setupDraftSession.ts` — autosave / conflict / completion state machine
- `lib/onboarding/setupEntry.ts` — the entry rule
- `scripts/support/testDatabase.ts` — throwaway local PostgreSQL 17 for the tests

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
  stored flag. What is now persisted is uncommitted input and a record that a
  specific commit happened — neither is a readiness flag.
- Drafts are scoped to a membership, not a user or a browser, so setup resumes on
  another device.

**Access.** Both new tables have RLS enabled, **no policies, and no table
privileges** for `anon` or `authenticated`. They are reachable only through three
`SECURITY DEFINER` functions. A revision counter and a stored completion result are
only trustworthy if no client can write them directly.

**Identity.** Each function takes the organization id and resolves the caller's
membership from `auth.uid()` — the same posture as `import_bell_schedule`. No
function accepts a membership id or user id. Owner and organization columns on
every committed row come from that resolved membership, never from the draft.

---

## 4. Autosave, resume, revisions, visible failures

`save_setup_draft(organization, expected_revision, payload)`:

- `expected_revision` null creates the draft (revision 1) and mints its operation id.
- Otherwise the save applies only if the stored revision still equals
  `expected_revision`, and increments it by one. The comparison is part of the
  `UPDATE` itself.
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
resend it. What is committed is exactly what was last saved at the revision the
caller names.

In order, inside one function call (one transaction):

1. Take a per-membership advisory lock.
2. If this operation id is already in `setup_completions`, return its stored result.
3. Check the draft exists, has this operation id, and is at `expected_revision`.
4. Validate everything (§6.1). Nothing has been written yet.
5. Insert teacher-owned `courses`, then `class_sections`.
6. Either insert a private `bell_schedules` row and its `schedule_blocks`, **or**
   insert `teacher_period_assignments` onto a shared schedule.
7. Upsert `teacher_schedule_preferences` (lunch wave, active schedule).
8. Insert the first `lessons` row and its `lesson_class_sections` row.
9. Insert the `setup_completions` row and delete the draft.

Any error at any step rolls back every step. The draft is deleted in the same
transaction that commits, so a draft exists exactly as long as its completion has
not committed.

### 6.1 Completion requirements — identical on both sides

`validateSetupDraft` (client) and `complete_setup` (database) enforce the same
rules. The database is the boundary; the client check exists so a teacher is told
before submitting.

- At least one class. Every class names a course that is in the draft, in the
  organization catalog, or owned by the caller.
- A schedule is chosen, and at least one class is placed in a period.
- A private schedule follows `import_bell_schedule`'s rules: named blocks, valid
  kinds, end after start, no overlaps, positions assigned from start time, block
  ids stored in scoped form.
- **A first lesson is required**, belongs to a class in the draft, and is
  "prepared" by the definition already used across the app
  (`getLessonPlanningStatus`): a non-blank learning target, or at least one agenda
  item, resource, or announcement.

`verify:onboarding-setup-db` §13 runs eleven drafts through both and asserts they
agree on every one.

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
| A different operation id for a completed membership | `conflict: already-completed` |
| Save applied, response lost, next save sent | Server reports a revision conflict; the session recognises the stored payload as its own unconfirmed write and adopts its revision without showing a conflict |

The repository reports every failed call as either `rejected` (the server answered
and refused; nothing applied) or `unknown` (no usable answer). After `unknown` on
completion the status is `completion-unconfirmed`, and the only action offered
should be to try again — which asks about the same operation.

---

## 8. Concurrency

### 8.1 Mechanisms

| Layer | What it does |
|---|---|
| Advisory lock, per membership, taken first by `save_setup_draft` and `complete_setup` | Overlapping calls for one membership run one after another. Under READ COMMITTED the later call sees the earlier one's commit. Different memberships never block each other. |
| Revision check | A save or completion naming any revision but the stored one changes nothing. For saves it is also in the `UPDATE`'s `WHERE`, so it holds as a single statement. |
| Operation replay | A completion whose operation id is already recorded returns that record. |
| `setup_drafts` primary key | One draft per membership. |
| `setup_completions` primary key and `UNIQUE (owner_membership_id)` | One record per operation; one completed setup per membership. |

The constraints are the backstop for anything the lock does not cover. The one
known case: a caller whose transaction is REPEATABLE READ and took its snapshot
before another request committed cannot see that commit, so the replay check
misses. It then fails on a unique or serialization error and writes nothing.
PostgREST uses READ COMMITTED by default.

### 8.2 What was verified, and how

`verify:onboarding-setup-concurrency` runs against a real PostgreSQL 17.10 server
with one connection per request. Overlap is established rather than assumed: the
test holds the membership's lock on a separate connection, fires the requests,
waits until `pg_stat_activity` shows all of them blocked on that lock, then
releases it.

| Scenario | Result |
|---|---|
| 8 overlapping completions of one operation | 1 commit, 7 replays, identical result to all, one row per table |
| 8 overlapping saves from one revision | 1 accepted, 7 `stale-revision`, revision +1, stored draft is the winner's whole |
| 8 overlapping creations of the first draft | 1 created, 7 `draft-exists`, one operation id |
| Save and completion overlapping, both orders | Whichever runs first wins; the other gets `stale-revision` or `completed` |
| Two memberships | Neither waits for the other |
| 10 × 16 unsynchronized completions; 10 × 16 unsynchronized saves | Same outcomes every round |
| Constraints with the lock out of the picture; REPEATABLE READ caller | Duplicate impossible; caller errors, one committed setup |

With the advisory lock removed, 18 of those checks fail — the suite detects its
absence.

### 8.3 Concurrency verification still pending

Not exercised, because no Supabase environment other than production exists:

- The same scenarios through **PostgREST and Supabase's connection pooler**. The
  design relies on each RPC being one transaction at READ COMMITTED on a session
  that honours transaction-level advisory locks. That is PostgREST's documented
  behaviour, and transaction-level locks are safe under transaction pooling, but it
  has not been observed on a Supabase project.
- Real network latency and client retry timing.

Run `verify:onboarding-setup-concurrency`'s scenarios against a disposable Supabase
project before these migrations are applied to production.

### 8.4 Two tabs, and a shared schedule that changed

**Two tabs on the same draft.** The second tab's save names an old revision and is
refused with the stored draft. Completing from a stale revision is refused the same
way. After one tab completes, any other tab's next save is answered `completed`,
and a new draft cannot be created.

**A shared schedule that changed.** When a teacher picks a shared schedule the
draft records it as shown: each period's id, label, kind and times in order, **and
each period's weekday overrides** (weekday, label, kind, times). At completion the
function rebuilds the same structure from the live rows and compares. Any
difference — a moved, added or removed period; an added, changed or removed weekday
override; the schedule deleted or marked as needing configuration — returns
`conflict: shared-schedule-changed` and writes nothing. The teacher reviews, the
draft is updated, and the same operation is submitted again.
`hasSharedScheduleChanged` makes the same comparison on the client so it can be
shown on resume. An override's class assignment is not compared: on an
organization-owned schedule it is never a teacher's own.

**An admin edit overlapping a completion.** The comparison and the writes are
separate statements and the shared schedule's rows are not locked, so an admin
edit can commit between them. This was assessed against the requirement above
("never committed against a schedule the teacher did not see") rather than
dismissed for being brief. Every such interleaving leaves exactly the state that
*completion, then the edit* leaves - which is the ordinary situation of any teacher
already on a shared schedule when an admin edits it:

- a period re-timed or renamed keeps its id; the assignment still points at it and
  follows the edit (concurrency §9b);
- a period or schedule deleted makes the completion's own insert wait on that row
  and then fail its foreign key, rolling the whole completion back; the retry
  reports `shared-schedule-changed` (concurrency §9a).

No interleaving produces a state the two operations could not produce one after the
other, so no lock was added. Locking the schedule's rows would also make every
teacher's ordinary period-assignment save wait behind any completion in the school.

**The account was set up the ordinary way meanwhile.** Eligibility is checked when
a draft is created *and again inside `complete_setup`*, after the two
already-completed checks (so a retry of a committed operation is still replayed)
and before anything is written. If the membership now owns a class or a schedule,
completion returns `conflict: no-longer-eligible` with the reason, writes nothing,
and leaves the preferences chosen in the ordinary screens alone;
`SetupDraftSession` reports it as `ineligible`. The check is made to hold until
commit by locking the membership row `FOR UPDATE`: an ordinary save's class or
schedule insert takes a key-share lock on that row for its foreign key, so one in
flight is waited for and seen, and a later one waits for the completion
(concurrency §8). `save_setup_draft` does not re-check on a revision: a draft is
scratch data and writing it changes nothing operational.

---

## 9. The operational app after completion

### 9.1 Design

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
   repository's baseline from them.

This makes the completing tab safe. Other tabs are the subject of §9.2.

### 9.2 An ordinary tab that was already open

**The problem.** An ordinary Falcon Deck tab loaded before setup completed holds a
full snapshot that predates it. Before the fix below, three things went wrong, all
reproduced with the real `SupabaseDataRepository` and the real `complete_setup`:

| | What the stale tab did | What happened |
|---|---|---|
| A | Changed its lunch wave | The whole `teacher_schedule_preferences` row was rewritten from stale memory: **the active schedule set by setup was cleared.** |
| B | Had one failed save, then saved again (teacher uses the school's schedule) | After a failure the repository discarded its baseline, re-read the whole database, and diffed that against stale memory. Everything the tab never knew about looked "removed": **the class, its period assignment and the first lesson were deleted.** |
| B2 | The same, teacher built their own schedule | **The first lesson was deleted**, then the save failed on a foreign key, and every later save from that tab failed. |

B was never specific to guided setup: any two ordinary tabs could do it to each
other.

**The fix** is two narrow changes inside `lib/data/supabaseDataRepository.ts`. The
diff, the write ordering, the queue and the coalescing are untouched.

1. **A failed save no longer replaces the baseline with a full re-read.** The
   baseline — what this tab knows the database held for the rows it has loaded or
   written — is kept. The rows the failed save set out to change are marked
   *uncertain*, and only those are re-read before the next save, so a half-written
   attempt is still corrected from the truth. A row that is neither in the baseline
   nor uncertain is one this tab did not create and has never seen; it is left out
   of the comparison entirely and can no longer be mistaken for a deletion.
2. **The two one-row-per-teacher tables are written column by column.**
   `teacher_schedule_preferences` and `classroom_experience_settings` are now
   updated with only the columns this tab changed, instead of upserted whole. A
   tab that changes the lunch wave sends the lunch wave. If no row exists yet, it
   is created with an insert that does nothing when a row is already there, and
   the changed columns are then applied — so if another tab creates the row in
   between, that tab's other columns are kept.

**Unsaved edits survive recovery.** A failed save does not consume the edit: the
provider still holds it and passes it to the next save, which now writes it in
full — including edits made between the failure and the retry, and including an
edit that was reverted in between (the uncertain row or field is re-read, so the
database ends where the tab does).

**What is now guaranteed, and tested** (`verify:stale-tab-save-safety`, real engine,
real `complete_setup`, local PostgreSQL 17):

- A, B and B2 above: setup's rows and its active schedule survive, the stale tab's
  save succeeds, and the stale tab's own edit is saved.
- Two ordinary tabs: one tab's failed-then-retried save does not delete what the
  other tab added.
- A half-written save is still cleaned up: an abandoned row is removed, a reverted
  preference ends reverted.
- A tab can still delete rows it knows about, and only those.

The same suite fails 17 checks against the previous engine.

**A class deleted in another tab.** Not adopting the re-read state wholesale has
one consequence that needed its own handling. Tab A deletes a class; tab B, still
showing it, edits one of its lessons. That lesson can never be written - its class
is gone - and because a save stops at its first failure, everything later in the
write order (library, display settings, preferences) was stuck behind it on every
retry. The old engine "recovered" only by re-creating the class tab A had deleted.

Now, when a save fails and the re-read shows a class this tab still has is gone
(and this tab was not itself changing that class), the engine:

- **holds back** the lesson edits for that class and writes everything else, in the
  same save call - one immediate second pass, not a retry loop;
- **does not re-create the class**, and deletes the half-written `lessons` row the
  failed attempt may have left;
- **returns `{ ok: false, reason: "held-back" }`** with a message naming the class,
  on that save and on every later one while the edit is still in the tab - never
  `ok: true`;
- leaves the edit in the tab's memory. It is reported again each save and stops
  being reported once the teacher puts the lesson back as it was, or reloads.

Limits: only **lessons** are handled. An edit to a deleted class's display
settings, period assignment or transition override, or to a class whose *course*
was deleted elsewhere, still fails every save from that tab until it is reloaded.
The held-back edit lives only in that tab; a reload discards it. And the app has
no app-wide save-failure indicator today - `persistence.error` is shown on two
settings screens only - so on most screens the teacher is not told about this or
any other failed save. That is existing behavior and needs UI work to change.

**What the fix does not do**

- **It is client code.** A tab still running a bundle from before this change
  behaves the old way until it is reloaded. Ship this ahead of wiring the entry
  rule, so no account can complete guided setup while old bundles are in use.
- **A stale tab still cannot see what it never loaded.** Setup's classes do not
  appear in it until a reload. Nothing is lost, but the tab is out of date.
- **A field or row the stale tab's user explicitly edits is still last-write-wins.**
  If they change the lunch wave, their lunch wave replaces the newer one. That is
  their edit, not a side effect, but it is not conflict detection.
- **It is not verified through PostgREST**, only against the same SQL the engine's
  calls produce (§8.3 applies here too).

**If a server-side guarantee is wanted later:** a *completion fence* — a trigger
on the teacher-owned tables that refuses a direct write from any client not
carrying the membership's completion id, plus a "this tab is out of date — reload"
state on the client. It would cover old bundles and make a stale tab reload
instead of merely being harmless. It is not needed for the data-loss cases above
and is not implemented.

## 10. Entry: new and interrupted accounts only

`get_setup_state` reports one of `completed`, `in-progress`, or `not-started` with
an eligibility verdict and a **seed**.

A membership is **established** — ineligible, keeps today's screens — when any of
these hold:

- `account_origin = 'legacy_import'` (migrated or pending)
- it owns a class section
- it owns a bell schedule of its own

Otherwise it is eligible. That deliberately includes an **interrupted** new
account: one that chose its school's schedule on the existing `/setup/schedule`
screen and went no further. Its only footprint is a preferences row, which — with
no schedule of its own — can only name an organization schedule. `get_setup_state`
returns that choice as `seed: { activeBellScheduleId, lunchWave }`, and
`createSetupDraftFromSeed` starts the draft with that schedule already selected and
the lunch wave kept. Completion upserts the same preferences row.

`deriveSetupEntry(authority, setupState)`:

| Account | Entry |
|---|---|
| New cloud account, nothing chosen | guided setup, empty draft |
| New cloud account that only chose a shared schedule | guided setup, seeded with that choice |
| Draft in progress (whatever else has happened since) | guided setup, resumed |
| Setup completed | existing app |
| Cloud account with classes or its own schedule | existing app |
| Legacy account, migrated | existing app |
| Legacy account, migration pending (`local` authority) | existing app — decided without consulting setup state |
| Setup state unavailable | existing app |

"Existing app" means today's behaviour exactly: `/setup`, `ActiveScheduleGate`,
`MigrationSetupCard`. Nothing calls `deriveSetupEntry` yet.

---

## 11. Unresolved limitations

1. **Stale ordinary tab after completion** — the data loss is fixed (§9.2). Still
   true: the fix is client-side, a stale tab does not show data it never loaded,
   and an explicitly edited field is last-write-wins. Edits to a class deleted
   elsewhere are handled for lessons only, and no screen but two shows a failed
   save (§9.2).
2. **Concurrency through PostgREST and the Supabase pooler is unverified** — §8.3.
3. **No disposable Supabase project exists.** The repo links only production.
   A Supabase preview branch would not work as-is:
   `20260922000000_organization_memberships_account_origin.sql` refuses to apply
   unless two specific production rows exist. The test harness seeds those rows.
4. **The test server is a 100 MB dev dependency.** `embedded-postgres` ships real
   PostgreSQL binaries per platform, and `pg` is its client. Both are
   `devDependencies`, so a Vercel build installs the Linux binaries too. If that
   cost is unwelcome, the three database scripts can move out of `npm run verify`
   and the packages be installed on demand.
5. **Ids are global.** `courses.id`, `class_sections.id` and others are single
   primary keys across all schools. A draft id that collides with any existing row
   fails the whole completion with Postgres's own message. Ids are generated with
   `crypto.randomUUID()`, so this is not expected in practice.
6. **Raw database messages can reach `completion-rejected`.** Validation failures
   carry written-for-users messages; unexpected failures do not. The UI should show
   its own wording for anything it does not recognise.
7. **One completion per membership, and no discard.** There is no "start over" or
   "run setup again". A draft can be overwritten but not deleted by the client;
   abandoned drafts do not expire.
8. **`lib/data/supabase.types.ts` is not regenerated.** The new functions are
   called through a narrow local type, as `import_bell_schedule` is.
9. **Draft size is capped at 256 KB** and drafts carry no uploaded files.

---

## 12. Verification

| Scenario | Where |
|---|---|
| Draft reload / resume | `verify:onboarding-setup-db` §3 |
| Concurrent stale draft update detected | db §4; concurrency §2 |
| Unauthorized access to another membership's draft or setup | db §5, §12 |
| Failure midway through completion rolls back | db §6 |
| Duplicate completion submissions | db §8; concurrency §1, §6 |
| Commit succeeds, response lost, retry creates no duplicates | db §9 |
| Shared schedule preserved; changed base period detected | db §10, §11 |
| Client and database completion rules agree; first lesson required | db §13 |
| Weekday override changes detected | db §14; foundation §7 |
| Interrupted accounts resume; established and legacy accounts unchanged | db §2, §15, §16; foundation §8 |
| Genuinely overlapping requests | `verify:onboarding-setup-concurrency` |
| Stale ordinary tab cannot overwrite or delete what it never loaded; unsaved edits survive a failed save | `verify:stale-tab-save-safety` |
| Lesson edit for a class deleted elsewhere is held back, reported, and blocks nothing else | stale-tab §10 |
| Completion refused once the account is set up the ordinary way; committed operations still replay | db §17; concurrency §8 |
| Admin edit of a shared schedule overlapping a completion | concurrency §9 |

The three `verify:onboarding-setup-*` scripts and `verify:stale-tab-save-safety`
are in `npm run verify`. The database
ones start a PostgreSQL 17 server in a temporary directory, apply every file in
`supabase/migrations` to it, and delete it. They read no environment file and
connect to nothing else.
