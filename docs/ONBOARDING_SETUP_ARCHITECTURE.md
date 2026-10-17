# Streamlined Onboarding — Architecture Decisions

**Status:** persistence foundation implemented and tested in isolation, awaiting
review. The two migrations below are **not applied to any Supabase project**. The
guided screens (§9.3) are built behind a server-side switch that is off by default
and always off in Production; with it off, no route, screen, or redirect has
changed and no existing account behaves differently.
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
- A draft also carries a **preferences baseline**: the membership's active schedule
  and lunch wave as they stood when the draft was created (`baseline_active_bell_schedule_id`,
  `baseline_lunch_wave`; no row means no schedule and `none`). `save_setup_draft`
  reads it from the database when it inserts the draft. The caller cannot supply it,
  and a later save never changes it. The save that creates the draft must also name
  the seed the draft was built from, and is refused if that is no longer what is
  stored (§8.4). §8.4 describes what the baseline is for.

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
| Membership row lock (`FOR UPDATE`), taken by `complete_setup` | Makes the eligibility re-check hold until commit against the ordinary save path, which never takes the advisory lock: every insert of a class or schedule for the membership needs a key-share lock on that row. |
| Membership row lock (`FOR NO KEY UPDATE`), taken by `save_teacher_schedule_preferences` before it touches the preferences row | The ordinary save's only way of writing `teacher_schedule_preferences`. Ordinary preference writes and completion therefore take the same lock first and the preferences row second, and whichever goes second works from a fresh snapshot. It does not block class or schedule inserts. |
| Preferences row lock (`FOR UPDATE`), taken by `complete_setup` just before it writes | Additionally covers a writer outside that protocol that is updating the row (§8.3). |

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
| An ordinary class insert in flight when completion runs | Completion waits for it, then returns `no-longer-eligible`; nothing written |
| Ordinary preference write first (row exists), completion second | Completion waits, without having touched `teacher_schedule_preferences`; then `preferences-changed`; nothing written; the newer value stands |
| Completion first, ordinary save second (row exists; completion activated a schedule it created) | The real repository save waits, without having touched the table; then succeeds; the newer lunch wave lands on top; the operation still replays |
| Ordinary first-row creation first, completion second | As the first row: completion waits untouched, then `preferences-changed` |
| Completion first (creating the row), ordinary first-row save second | The save waits untouched - the same lock order on both sides; then succeeds; one row, newer lunch wave on top |
| Control: completion first, a direct table `UPDATE` second | The direct `UPDATE` waits already holding the table, then is rejected by RLS (`42501`) - the behaviour the protocol removes |
| 8 unsynchronized rounds of completion and an ordinary write (supplementary) | Every round: completion refused or the write landed on top; no write rejected |

Each ordering case is made deterministic, not raced: one side runs in a transaction
the test holds open, and while the other waits the test reads `pg_locks` for it.

With the advisory lock removed, 18 of those checks fail — the suite detects its
absence.

### 8.3 Concurrency through PostgREST, and what is still pending

**Through PostgREST.** These were run on a local integration stack:
PostgreSQL 17.10, Supabase Auth v2.197.0, PostgREST v14.5, Supabase's role layout
and default privileges, and a gateway standing in for Kong.
`docs/ONBOARDING_SETUP_RELEASE.md` §5 describes the stack.

- **Lock order over HTTP.** One side was held open on a direct connection and the
  other was a live PostgREST request (`complete_setup` or the ordinary save), in both
  directions and for the first row. Each time the request waited without having
  touched `teacher_schedule_preferences`, then gave the same outcome as §8.2.
- **The existing suite on the same database.** `verify:onboarding-setup-concurrency`
  passed against the stack's database (71 checks), over direct connections.

**On hosted Supabase.** Functional and authorization checks passed on the hosted
staging project, `falcondeck-staging` (release document §5). The lock-order
scenarios did not run there; they need a direct database connection.

Still not exercised:

- **Supabase's pooler (Supavisor), and lock order on a Supabase project.** The
  design relies on each RPC being one transaction at READ COMMITTED.
  Transaction-level advisory and row locks are safe under transaction pooling, but
  this has not been observed on a Supabase project.
- Real network latency and client retry timing.

**One protocol for preference writes.** The ordinary save used to write
`teacher_schedule_preferences` directly. Overlapping a completion, that produced a
rejected save (the `UPDATE` re-checked RLS with a snapshot from before the
completion's new schedule existed) and an opposite lock order for the first row (the
`INSERT` wrote the row, then waited for the membership row). It now calls
`save_teacher_schedule_preferences`
(`20261010210200_teacher_schedule_preferences_write_rpc.sql`), which takes the
membership row lock first and then runs the same update-then-create-if-missing
statements. It is `SECURITY INVOKER`, so those statements run under the table's
existing RLS unchanged. Only the lock is taken by a small `SECURITY DEFINER` helper,
because locking a row needs the right to update it and the membership table's update
policy is admin-only. Both observed problems are gone for writes made this way
(§8.2), and so is the client-side gap between the update and the create.

**Known limits.** Stated rather than covered:

- **Writers outside the protocol.** A client bundle from before this change, a
  direct API call, and the one-time legacy migration
  (`lib/data/migration/migrateLocalData.ts`, which upserts the row) still write the
  table directly. RLS still governs them, but they can still be rejected while a
  completion commits (§8.2 control), and a direct first-row insert can still take
  its locks in the opposite order. The legacy migration only runs for legacy
  accounts, which are never eligible for guided setup. Direct writes were not
  revoked; that would be a wider change.
- **Deploy order.** The ordinary save now depends on the new function. Applying the
  migration has to come before, or with, shipping this client code; otherwise every
  preference save fails.
- **`save_setup_draft`'s eligibility and seed checks take no lock.** A save that
  overlaps an ordinary write can still be accepted once. Nothing operational is
  written, and the completion check catches any change committed after the
  baseline was read.
- All of this was run with direct PostgreSQL connections, like the rest of §8.2.

### 8.4 Two tabs, and a shared schedule that changed

**Two tabs on the same draft.** The second tab's save names an old revision and is
refused with the stored draft. Completing from a stale revision is refused the same
way. After one tab completes, any other tab's next save is answered `completed`,
and a new draft cannot be created.

**A shared schedule that changed.** When a teacher picks a shared schedule the
draft records it as shown: each period's id, label, kind, custom-kind label,
lunch-window flag and times in order, **and each period's weekday overrides**
(weekday, label, kind, custom-kind label, times). At completion the function
rebuilds the same structure from the live rows and compares. Any difference — a
moved, added or removed period; a period that became or stopped being the lunch
window; a changed custom-kind label; an added, changed or removed weekday override;
the schedule deleted or marked as needing configuration — returns
`conflict: shared-schedule-changed` and writes nothing. A draft that names no
schedule at all is a different thing: there is nothing to review, so it is refused
as a validation error. The teacher reviews, the
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
(concurrency §8).

Existing setup outranks the unfinished draft everywhere, not only at completion.
`get_setup_state` stops reporting the draft and answers `not-started`, not eligible;
`save_setup_draft` returns `ineligible` for a revision as well as for a first save;
`deriveSetupEntry` therefore sends the account to the existing app (§10). The draft
row is kept, unchanged and unreachable - there is no discard. Only a committed
completion ranks higher: its result is still returned and its retry still replayed.
The eligibility check in `save_setup_draft` is not locked: a save that overlaps the
ordinary insert can still be accepted once. That changes nothing operational, and
the next save or completion is refused.

**Schedule preferences changed meanwhile.** An *interrupted* account (§10) stays
eligible, so the ordinary screens can still change its active schedule or lunch
wave after a draft exists, and completion writes both. `complete_setup` therefore
compares the stored preferences with the draft's baseline (§3) as its last check,
before any write. For the active schedule and the lunch wave separately: if the
value is no longer the baseline **and** is not the value this draft is about to
write, it returns `conflict: preferences-changed` with the current values and
writes nothing. A draft saved again does not escape this - saving never moves the
baseline. A draft that has been brought into line with the newer value completes,
because it then writes that same value. There is deliberately no way to insist on
the draft's older choice; in particular, a draft that builds a private schedule
cannot complete while a different schedule has been made active elsewhere.
`SetupDraftSession` reports the conflict with the current preferences attached.

The baseline itself is checked when it is taken. The save that creates a draft names
the seed the draft was built from (`get_setup_state`'s `seed`). If the stored
preferences are no longer exactly that, nothing is created and the same
`preferences-changed` answer returns what they are now. Otherwise the draft would
start with the older choices while its baseline recorded the newer ones, and
completion - comparing against that baseline - would replace them without a
conflict. The named seed is only compared; the baseline is still read from the
database. `SetupDraftSession.adoptPreferences(rebuilt)` resolves either conflict: the
reported preferences become the seed and the rebuilt draft is saved. Re-sending the
old draft with the old seed is simply refused again.

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
   updated with only the columns this tab changed, instead of upserted whole.
   (For `teacher_schedule_preferences` the same statements now run inside
   `save_teacher_schedule_preferences` - §8.3.) A
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
- **Verified through PostgREST only on the local integration stack** (§8.3), not on
  a Supabase project.

**If a server-side guarantee is wanted later:** a *completion fence* — a trigger
on the teacher-owned tables that refuses a direct write from any client not
carrying the membership's completion id, plus a "this tab is out of date — reload"
state on the client. It would cover old bundles and make a stale tab reload
instead of merely being harmless. It is not needed for the data-loss cases above
and is not implemented.

### 9.3 As built: the guided screens (`/start`)

Three steps, all writing through `SetupDraftSession` only: "Your teaching day",
"Your first lesson", "Review and start". `/start` renders only when the entry rule
(§10) answers `guided-setup` and `FALCON_GUIDED_SETUP=on` outside Production;
otherwise it redirects to `/setup`.

- **Review** summarizes the schedule, each period's class, the lunch wave and the
  lesson, with Edit actions back to step 1 or 2. Every step change commits typed
  text and waits for the save first.
- **Preview (§9.1.3):** the existing `PreviewPresentScreen`, inside an
  `AppDataProvider` given `readOnlyRepository(projectSetupDraftToAppData(...))`.
  That repository's `save()` writes nowhere; no `CutoverAppDataProvider`,
  `useAppData` caller or localStorage repository exists on the page, and the
  boundary checks assert it. Its period comes from `previewPeriods()`: the
  projected active schedule resolved for the lesson's weekday
  (`resolveActiveSchedule` + `resolveScheduleForWeekday`, as Present's Preview
  Mode does), keeping the blocks that hold the lesson's class. A lesson belongs
  to a class and date, not a period, so: one match is shown; several (a class
  meeting more than once that day, e.g. via a weekday override) get a period
  picker; none (the class is unassigned that weekday) is said plainly and the
  display shows no period. The guided draft makes one class per period, so in
  practice there is one match.
- **Start my classroom** saves anything outstanding, re-checks the draft, then
  calls `complete()` once. While it runs, further presses do nothing and the steps
  are locked. The operation id is fixed for the draft, so pressing again after an
  unconfirmed answer is answered from the committed record (§7). A save that learns
  setup already committed counts as success.
- **On success (§9.1.4):** a full document load of `/present`
  (`window.location.assign`), not a client-side route change, so the new
  `CutoverAppDataProvider` loads the committed rows.
- **Conflict recovery:**

  | Answer | What the teacher sees and can do |
  |---|---|
  | `stale-revision` | Both versions, then "Use the saved version" or "Keep what's on this screen". |
  | `shared-schedule-changed` | Reloads the school's schedules (`loadGuidedReference`, read-only). `refreshSharedSchedule` keeps classes in periods that still exist and the lesson. Returns to step 1 to review. |
  | `preferences-changed` | Shows the stored schedule and lunch wave. "Use these settings and continue" adopts them through `adoptPreferences`; there is no way to insist on the older choice. A different schedule returns to step 1; the lesson keeps its date and target. |
  | `no-longer-eligible` | Back to the existing app (`/setup`), nothing written. |
  | `already-completed` | Treated as success (§7). |

**Session fix found by this work.** `pump()` joined a save pass in flight even when
that pass had already decided there was nothing it could send. A recovery that
rebuilds the draft and resolves the conflict in the same tick (the schedule refresh
above) was therefore never saved. A joining caller now gets a pass of its own once
the current one settles, if edits are outstanding and the pass didn't stop on a
failed save. Covered by `verify:guided-setup-teaching-day` §10.
## 10. Entry: new and interrupted accounts only

`get_setup_state` reports one of `completed`, `in-progress`, or `not-started` with
an eligibility verdict and a **seed**. It checks them in that order of authority: a
committed completion first, then eligibility, and a draft only for a membership
that is still eligible.

A membership is **established** — ineligible, keeps today's screens — when any of
these hold:

- `account_origin = 'legacy_import'` (migrated or pending)
- it owns a class section
- it owns a bell schedule of its own

An established membership is never reported as `in-progress`, whether or not it
once started a draft.

Otherwise it is eligible. That deliberately includes an **interrupted** new
account: one that chose its school's schedule on the existing `/setup/schedule`
screen and went no further. Its only footprint is a preferences row, which — with
no schedule of its own — can only name an organization schedule. `get_setup_state`
returns that choice as `seed: { activeBellScheduleId, lunchWave }`, and
`createSetupDraftFromSeed` starts the draft with that schedule already selected and
the lunch wave kept. Completion upserts the same preferences row - unless that row
has been changed again since the draft was created (§8.4).

`deriveSetupEntry(authority, setupState)`:

| Account | Entry |
|---|---|
| New cloud account, nothing chosen | guided setup, empty draft |
| New cloud account that only chose a shared schedule | guided setup, seeded with that choice |
| Draft in progress, account still eligible | guided setup, resumed |
| Draft in progress, then set up through the ordinary screens | existing app - the draft is kept but no longer offered |
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
2. **Concurrency through the Supabase pooler is unverified.** Through PostgREST it
   was verified on a local integration stack (§8.3).
3. **The non-production Supabase project is a Free-plan staging project**
   (`falcondeck-staging`). It pauses after about a week of inactivity, and nobody
   here holds a direct database connection to it. A Supabase preview branch
   would not work as-is:
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
   abandoned drafts do not expire. A draft whose account was then set up through
   the ordinary screens stays in the table, unreachable.
8. **`lib/data/supabase.types.ts` is not regenerated.** The new functions are
   called through a narrow local type, as `import_bell_schedule` is.
9. **Draft size is capped at 256 KB** and drafts carry no uploaded files.
10. **The preferences protection has limits** - writers outside the
    `save_teacher_schedule_preferences` protocol, the deploy order it creates, and
    unlocked checks in `save_setup_draft`. See §8.3. A `preferences-changed` conflict
    can only be resolved by changing the draft or the stored preferences; there is
    no "replace anyway".
11. **Follow-ups left for a later pass.** `timeZone`, `colorHex`, a course
    `description` and the elements of the first lesson's arrays are stored without
    validation beyond the draft size cap. And `complete_setup` answers differently
    for another membership's operation id (`42501`) than for an unknown one
    (`draft-missing`), which reveals that such an id exists; ids are random UUIDs.

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
| Lunch-window and custom-kind-label changes detected | db §20; foundation §7 |
| A shared-schedule draft naming no schedule is a validation error | db §21 |
| Interrupted accounts resume; established and legacy accounts unchanged | db §2, §15, §16; foundation §8 |
| Draft started, then ordinary setup: entry bypasses guided setup; saves and completion cannot reopen it; draft retained | db §15c, §17, §18 |
| Schedule-only and lunch-wave-only preference changes after draft creation; baseline survives saves; committed operations still replay | db §19 |
| Ordinary preference writes and completion, each order, first row and existing row | concurrency §10 |
| Preferences changed between reading the seed and the first draft save; baseline cannot be chosen by the caller | db §22 |
| Guided screens: one commit for repeated presses; failed and lost answers retried under the same operation id; each conflict's recovery; pending text committed before Edit, Back, Continue and Start | `verify:guided-setup-interactions` §16–24 (real Chromium) |
| Guided completion against PostgreSQL: lost answer then replay, rows created once, reload leaves guided setup, `/present`'s repository loads the committed lesson | `verify:guided-setup-teaching-day` §14 |
| The review preview's provider is read-only and the only one on the guided page | `verify:guided-setup-teaching-day` §7c, §13 |
| Ordinary preference writes keep their authorization | db §23 |
| The ordinary save writes preferences only through the RPC | stale-tab §9 |
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
