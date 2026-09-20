/**
 * Regression coverage for the real production migration failure:
 *
 *   Migration failed: migrate schedule_blocks: ON CONFLICT DO UPDATE
 *   command cannot affect row a second time
 *
 * Root cause (see reducer.ts's former DUPLICATE_SCHEDULE case): duplicating
 * a schedule via the real "Duplicate" action (ScheduleList.tsx ->
 * actions.duplicateSchedule) assigned the new BellSchedule a fresh id, but
 * `structuredClone(source)` carried every nested ScheduleBlock's `id` (and
 * every ScheduleBlockOverride's `id`) over UNCHANGED. Locally this was
 * invisible - block ids only ever needed to be unique within their own
 * schedule's `blocks` array. migrateLocalData.ts flattens EVERY schedule's
 * blocks into one array and upserts them in a single `schedule_blocks`
 * call; Supabase's default upsert conflict target is the primary key
 * (`schedule_blocks.id text primary key`). A batch containing two rows
 * with the same `id` makes Postgres raise exactly the error above.
 *
 * The fix has two parts:
 *   1. lib/data/supabaseMapping.ts's scheduleBlockCloudId/
 *      scheduleBlockOverrideCloudId scope every cloud id to its owning
 *      schedule/block (via lib/data/scopedCloudId.ts's deterministic,
 *      injective, escaped join) - so two blocks that happen to share a
 *      *local* id, from two different schedules, can never collide in the
 *      cloud table. Both migrateLocalData.ts and supabaseDataRepository.ts
 *      (migration AND every ongoing save) route through these same
 *      functions, so they always agree on a given local object's cloud id.
 *   2. reducer.ts's DUPLICATE_SCHEDULE now regenerates a fresh id for
 *      every nested block/override, so a *newly* created duplicate never
 *      reproduces this locally in the first place.
 *
 * Part 1 alone is what makes the ALREADY-STUCK production migration safe
 * to retry without any cleanup: the user's real localStorage already has
 * the legacy (pre-fix) duplicated-id shape and will not be rewritten
 * before they retry, so the mapper - not the reducer fix - is what has to
 * carry the load for their specific account. Test 2 below is the direct
 * proof of that.
 *
 * No network/Supabase call is made anywhere in this file. The upsert
 * duplicate-detection is validated by a small in-memory fake Supabase
 * client that reproduces PostgREST's real behavior closely enough for
 * this purpose: `.upsert(rows)` is one batch, and a batch containing two
 * rows with the same `id` fails with Postgres's real error text, exactly
 * like the production incident.
 *
 *   npx tsx scripts/verify-migration-schedule-block-conflict.ts
 */

import { appDataReducer } from "@/lib/store/reducer";
import { createOhhsRegularSchedule, OHHS_REGULAR_ID } from "@/lib/schedule/presets/ohhsRegular";
import * as Map_ from "@/lib/data/supabaseMapping";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import { migrateLocalData, markMigrationComplete } from "@/lib/data/migration/migrateLocalData";
import { applyDiff } from "@/lib/data/supabaseDataRepository";
import { createDemoAppData } from "@/lib/data/demoData";
import type { AppData } from "@/lib/data/types";
import type { BellSchedule } from "@/types/schedule";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const FAKE_CTX: OwnerContext = {
  organizationId: "00000000-0000-0000-0000-000000000000",
  membershipId: "00000000-0000-0000-0000-000000000001",
};

/** Exactly migrateLocalData.ts's schedule_blocks upsert-batch construction (step 3-5). */
function buildScheduleBlocksUpsertBatch(schedules: AppData["schedules"]) {
  return schedules.flatMap((schedule) =>
    schedule.blocks.map((block, position) => Map_.scheduleBlockToRow(block, position, schedule.id, FAKE_CTX)),
  );
}

/**
 * Reproduces the PRE-FIX DUPLICATE_SCHEDULE behavior exactly (a plain
 * structuredClone, ids untouched) - representing a real teacher's
 * ALREADY-SAVED localStorage, which this fix does not and must not
 * rewrite. Only used to build legacy-shaped fixtures below; production
 * code no longer does this (see reducer.ts).
 */
function legacyDuplicateSchedule(source: BellSchedule, newId: string, newName: string): BellSchedule {
  return { ...structuredClone(source), id: newId, name: newName, isDefault: false, source: "custom" };
}

/**
 * Minimal in-memory fake Supabase client - just enough of the
 * `.from(table).upsert(rows)` / `.select(...).eq(...).single()` surface
 * migrateLocalData.ts and applyDiff actually use, with PostgREST's real
 * "duplicate id within one batch" failure reproduced faithfully. No
 * network. No real Supabase project is touched anywhere in this file.
 */
interface FakeRow {
  id?: string;
  [key: string]: unknown;
}

/**
 * Most tables use a plain `id text primary key` (the shape this fix
 * touches), so `row.id` is the default conflict key. A couple of join
 * tables migrateLocalData.ts also writes have a composite primary key
 * instead (no `id` column at all) - unrelated to this defect, but the
 * fake client still needs the real key to avoid a false "duplicate"
 * whenever a full migrateLocalData() run is exercised end to end.
 */
const CONFLICT_KEY_BY_TABLE: Record<string, (row: FakeRow) => string> = {
  // primary key (lesson_id, class_section_id) - supabase/migrations/20260914130100_lessons.sql
  lesson_class_sections: (row) => `${row.lesson_id}::${row.class_section_id}`,
  // primary key (library_resource_id, course_id) - supabase/migrations/20260914130200_library_resources.sql
  library_resource_courses: (row) => `${row.library_resource_id}::${row.course_id}`,
  // primary key class_section_id - supabase/migrations/20260914130300_teacher_personal_settings.sql
  class_presentation_settings: (row) => row.class_section_id as string,
  // primary key owner_membership_id (one row per teacher) - same migration
  classroom_experience_settings: (row) => row.owner_membership_id as string,
  teacher_schedule_preferences: (row) => row.owner_membership_id as string,
};

function conflictKey(table: string, row: FakeRow): string {
  return CONFLICT_KEY_BY_TABLE[table]?.(row) ?? (row.id as string);
}

/** Chainable, awaitable `.delete().eq(col, val).eq(col2, val2)` - deletes every row matching ALL accumulated column filters once awaited. */
class FakeDeleteBuilder implements PromiseLike<{ data: null; error: null }> {
  private filters: Array<[string, string]> = [];
  constructor(private table: Map<string, FakeRow>) {}

  eq(column: string, value: string): this {
    this.filters.push([column, value]);
    return this;
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    for (const [key, row] of [...this.table.entries()]) {
      if (this.filters.every(([column, value]) => row[column] === value)) {
        this.table.delete(key);
      }
    }
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

class FakeSupabaseClient {
  private tables = new Map<string, Map<string, FakeRow>>();
  private membership: { local_data_migrated_at: string | null };

  constructor(initialMigratedAt: string | null = null) {
    this.membership = { local_data_migrated_at: initialMigratedAt };
  }

  rowCount(table: string): number {
    return this.tables.get(table)?.size ?? 0;
  }

  allRows(table: string): FakeRow[] {
    return [...(this.tables.get(table)?.values() ?? [])];
  }

  seed(table: string, rows: FakeRow[]) {
    const t = this.tableFor(table);
    for (const row of rows) t.set(conflictKey(table, row), row);
  }

  private tableFor(name: string): Map<string, FakeRow> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  from(name: string) {
    const table = this.tableFor(name);
    const membership = this.membership;
    return {
      select: (_cols: string) => ({
        eq: (_col: string, _value: string) => ({
          single: async () => ({ data: { local_data_migrated_at: membership.local_data_migrated_at }, error: null }),
        }),
      }),
      update: (patch: { local_data_migrated_at?: string }) => ({
        eq: (_col: string, _value: string) => {
          if (patch.local_data_migrated_at !== undefined) membership.local_data_migrated_at = patch.local_data_migrated_at;
          return Promise.resolve({ data: null, error: null });
        },
      }),
      upsert: async (rowsOrRow: FakeRow | FakeRow[]) => {
        const rows = Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow];
        // Reproduce Postgres's real "ON CONFLICT DO UPDATE command cannot
        // affect row a second time": a single statement/batch can't apply
        // two different resolutions to the same target row.
        const seenInBatch = new Set<string>();
        for (const row of rows) {
          const key = conflictKey(name, row);
          if (seenInBatch.has(key)) {
            return { data: null, error: { message: "ON CONFLICT DO UPDATE command cannot affect row a second time" } };
          }
          seenInBatch.add(key);
        }
        for (const row of rows) table.set(conflictKey(name, row), row);
        return { data: rows, error: null };
      },
      delete: () => new FakeDeleteBuilder(table),
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

async function main() {
  // -------------------------------------------------------------------
  // 1. DUPLICATE_SCHEDULE hygiene fix: no nested id collisions after duplicating
  // -------------------------------------------------------------------
  console.log("1. Duplicating a schedule through the real, fixed DUPLICATE_SCHEDULE reducer path");
  {
    const base = createDemoAppData();
    const withOhhs = appDataReducer(base, { type: "ADD_SCHEDULE", schedule: createOhhsRegularSchedule() });
    const duplicated = appDataReducer(withOhhs, {
      type: "DUPLICATE_SCHEDULE",
      scheduleId: OHHS_REGULAR_ID,
      newId: "schedule-mike-ehinger-regular-day",
      newName: "Mike Ehinger - Regular Day",
    });

    const original = duplicated.schedules.find((s) => s.id === OHHS_REGULAR_ID)!;
    const copy = duplicated.schedules.find((s) => s.id === "schedule-mike-ehinger-regular-day")!;

    check(
      "1a: the duplicate has the same number of blocks, same content, in the same order",
      copy.blocks.length === original.blocks.length &&
        copy.blocks.every((b, i) => b.label === original.blocks[i].label && b.startTime === original.blocks[i].startTime),
    );
    check(
      "1b: FIXED - every duplicated block gets a fresh id, none matching the source",
      copy.blocks.every((b) => !original.blocks.some((ob) => ob.id === b.id)),
    );
    check(
      "1c: the duplicate's block ids are themselves all distinct",
      new Set(copy.blocks.map((b) => b.id)).size === copy.blocks.length,
    );
    check(
      "1d: duplicating the source did not mutate it (source blocks keep their original ids)",
      original.blocks.every((b) => b.id.startsWith(OHHS_REGULAR_ID)),
    );

    const batch = buildScheduleBlocksUpsertBatch(duplicated.schedules);
    const ids = batch.map((row) => row.id);
    check("1e: a freshly-duplicated schedule's migration batch has zero id collisions", new Set(ids).size === ids.length);
  }

  console.log("\n1f. Overrides are also regenerated on duplication, and the source's overrides are untouched");
  {
    const scheduleWithOverride: BellSchedule = {
      id: "schedule-with-override",
      name: "Has An Override",
      isDefault: false,
      timeZone: "America/Detroit",
      blocks: [
        {
          id: "block-enrichment",
          label: "Enrichment",
          kind: "enrichment",
          startTime: "09:29",
          endTime: "09:49",
          overrides: [{ id: "override-thursday-sat", weekday: "thursday", label: "SAT Prep", kind: "instructional" }],
        },
      ],
    };
    const base = createDemoAppData();
    const withSchedule = appDataReducer(base, { type: "ADD_SCHEDULE", schedule: scheduleWithOverride });
    const duplicated = appDataReducer(withSchedule, {
      type: "DUPLICATE_SCHEDULE",
      scheduleId: "schedule-with-override",
      newId: "schedule-with-override-copy",
      newName: "Has An Override (Copy)",
    });
    const original = duplicated.schedules.find((s) => s.id === "schedule-with-override")!;
    const copy = duplicated.schedules.find((s) => s.id === "schedule-with-override-copy")!;
    check("1f-i: the duplicate's override has fresh content matching the source", copy.blocks[0].overrides[0].label === "SAT Prep");
    check(
      "1f-ii: the duplicate's override id is NOT the source's",
      copy.blocks[0].overrides[0].id !== original.blocks[0].overrides[0].id,
    );
    check("1f-iii: the source's override is untouched", original.blocks[0].overrides[0].id === "override-thursday-sat");
  }

  // -------------------------------------------------------------------
  // 2-4. The scoped mapper migrates a LEGACY (already-duplicated) snapshot
  //      correctly - this is what actually unblocks the real stuck teacher,
  //      since their existing localStorage will not be rewritten by the
  //      reducer fix above.
  // -------------------------------------------------------------------
  console.log(
    "\n2-4. A LEGACY snapshot (built the OLD, pre-fix way - exactly what the real teacher's localStorage already contains)" +
      " still migrates correctly through the scoped mapper",
  );
  {
    const ohhs = createOhhsRegularSchedule();
    const legacyCopy = legacyDuplicateSchedule(ohhs, "schedule-mike-ehinger-regular-day", "Mike Ehinger - Regular Day");
    const schedules = [ohhs, legacyCopy];

    check(
      "2a: sanity - the legacy fixture really does reproduce the bug shape (raw ids collide)",
      legacyCopy.blocks.every((b, i) => b.id === ohhs.blocks[i].id),
    );

    const batch = buildScheduleBlocksUpsertBatch(schedules);
    const ids = batch.map((row) => row.id);
    check(
      "2b: FIXED - the legacy snapshot's migration batch has zero id collisions despite the shared local ids",
      new Set(ids).size === ids.length,
    );

    const ohhsRows = batch.filter((row) => row.bell_schedule_id === OHHS_REGULAR_ID);
    const copyRows = batch.filter((row) => row.bell_schedule_id === "schedule-mike-ehinger-regular-day");
    check("3a: original schedule's blocks all remain attached to the original bell_schedule_id", ohhsRows.length === ohhs.blocks.length);
    check(
      "3b: duplicate schedule's blocks all remain attached to the duplicate's own bell_schedule_id",
      copyRows.length === legacyCopy.blocks.length,
    );
    check(
      "3c: original and duplicate produce entirely distinct row ids (no overlap at all)",
      ohhsRows.every((r) => !copyRows.some((c) => c.id === r.id)),
    );

    // Overrides: build a legacy schedule whose blocks DO have overrides, duplicated the old way.
    const scheduleWithOverride: BellSchedule = {
      id: "schedule-legacy-with-override",
      name: "Legacy With Override",
      isDefault: false,
      timeZone: "America/Detroit",
      blocks: [
        {
          id: "block-enrichment",
          label: "Enrichment",
          kind: "enrichment",
          startTime: "09:29",
          endTime: "09:49",
          overrides: [{ id: "override-thursday-sat", weekday: "thursday", label: "SAT Prep", kind: "instructional" }],
        },
      ],
    };
    const legacyOverrideCopy = legacyDuplicateSchedule(
      scheduleWithOverride,
      "schedule-legacy-with-override-copy",
      "Legacy With Override (Copy)",
    );
    const overrideSchedules = [scheduleWithOverride, legacyOverrideCopy];
    const overrideBatch = overrideSchedules.flatMap((schedule) =>
      schedule.blocks.flatMap((block) => {
        const cloudBlockId = Map_.scheduleBlockCloudId(schedule.id, block.id);
        return block.overrides.map((override) => Map_.scheduleBlockOverrideToRow(override, cloudBlockId, FAKE_CTX));
      }),
    );
    const overrideIds = overrideBatch.map((row) => row.id);
    check("4a: legacy overrides sharing a raw local id also get distinct cloud ids", new Set(overrideIds).size === overrideIds.length);
    const fks = overrideBatch.map((row) => row.schedule_block_id);
    check(
      "4b: each override's schedule_block_id FK matches the actual cloud id that scheduleBlockToRow would write for its real parent block",
      fks[0] === Map_.scheduleBlockCloudId("schedule-legacy-with-override", "block-enrichment") &&
        fks[1] === Map_.scheduleBlockCloudId("schedule-legacy-with-override-copy", "block-enrichment") &&
        fks[0] !== fks[1],
    );
  }

  // -------------------------------------------------------------------
  // 5-6. Partial-migration retry safety and idempotence
  // -------------------------------------------------------------------
  console.log(
    "\n5-6. A partially-migrated cloud state (courses/class_sections/bell_schedules already present," +
      " zero schedule_blocks - exactly the real stuck org's shape) retries safely and is idempotent",
  );
  {
    const ohhs = createOhhsRegularSchedule();
    const legacyCopy = legacyDuplicateSchedule(ohhs, "schedule-mike-ehinger-regular-day", "Mike Ehinger - Regular Day");
    const snapshot: AppData = { ...createDemoAppData(), schedules: [ohhs, legacyCopy] };

    const client = new FakeSupabaseClient(null);
    // Pre-seed exactly what the real production org already has: courses,
    // class_sections, and bell_schedules committed; schedule_blocks empty.
    client.seed("courses", snapshot.courses.map((c) => Map_.courseToRow(c, FAKE_CTX)));
    client.seed("class_sections", snapshot.classSections.map((s) => Map_.classSectionToRow(s, FAKE_CTX)));
    client.seed("bell_schedules", snapshot.schedules.map((s) => Map_.bellScheduleToRow(s, FAKE_CTX)));

    const firstAttempt = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    check(
      "5a: the corrected migration completes fully against the pre-populated partial state, no cleanup performed first",
      firstAttempt.ok === true,
    );
    if (firstAttempt.ok) {
      check(
        "5b: it did not need to re-add courses/sections/schedules - counts still match the full snapshot (idempotent re-upsert, not duplication)",
        firstAttempt.counts.courses === snapshot.courses.length && firstAttempt.counts.bellSchedules === snapshot.schedules.length,
      );
    }
    check(
      "5c: courses table did not grow beyond the real distinct count (no duplicate rows from re-upserting)",
      client.rowCount("courses") === snapshot.courses.length,
    );
    check("5d: bell_schedules table did not grow beyond the real distinct count", client.rowCount("bell_schedules") === snapshot.schedules.length);
    const expectedBlockRows = ohhs.blocks.length + legacyCopy.blocks.length;
    check(
      "5e: schedule_blocks now has one row per block across BOTH schedules - the original failure point is resolved",
      client.rowCount("schedule_blocks") === expectedBlockRows,
    );

    const beforeRetryBlocks = client.allRows("schedule_blocks").map((r) => ({ ...r }));
    const secondAttempt = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    check("6a: retrying the already-completed migration again still reports success", secondAttempt.ok === true);
    check("6b: retrying again does not change the schedule_blocks row count (idempotent, no duplicates)", client.rowCount("schedule_blocks") === expectedBlockRows);
    check(
      "6c: retrying again writes back byte-identical rows (pure function of the same local snapshot, not a random/growing id)",
      JSON.stringify([...client.allRows("schedule_blocks")].sort((a, b) => (a.id as string).localeCompare(b.id as string))) ===
        JSON.stringify([...beforeRetryBlocks].sort((a, b) => (a.id as string).localeCompare(b.id as string))),
    );
  }

  // -------------------------------------------------------------------
  // 7-8. local_data_migrated_at stays unset on failure, only settable
  //      externally after validation - migrateLocalData never touches it.
  // -------------------------------------------------------------------
  console.log("\n7-8. local_data_migrated_at is never written by migrateLocalData itself, success or failure");
  {
    const snapshot: AppData = { ...createDemoAppData() };

    // Failure case: force a duplicate-id collision (the exact original bug,
    // still reachable if a snapshot were somehow malformed) and confirm the
    // marker is untouched.
    const brokenSchedule: BellSchedule = {
      ...createOhhsRegularSchedule(),
      blocks: [...createOhhsRegularSchedule().blocks, createOhhsRegularSchedule().blocks[0]], // deliberately duplicated within one schedule
    };
    const failingClient = new FakeSupabaseClient(null);
    const failingSnapshot: AppData = { ...snapshot, schedules: [brokenSchedule] };
    const failedResult = await migrateLocalData(failingClient as Client, FAKE_CTX, failingSnapshot);
    check("7a: the forced-failure case actually fails (sanity check on the test itself)", failedResult.ok === false);
    // Read it back the same way migrateLocalData does, to prove nothing wrote to it.
    const failureMembership = await failingClient
      .from("organization_memberships")
      .select("local_data_migrated_at")
      .eq("id", FAKE_CTX.membershipId)
      .single();
    check("7c: local_data_migrated_at remains null after a failed migration", failureMembership.data.local_data_migrated_at === null);

    // Success case.
    const successClient = new FakeSupabaseClient(null);
    const successResult = await migrateLocalData(successClient as Client, FAKE_CTX, snapshot);
    check("8a: the success case actually succeeds (sanity check)", successResult.ok === true);
    const successMembership = await successClient
      .from("organization_memberships")
      .select("local_data_migrated_at")
      .eq("id", FAKE_CTX.membershipId)
      .single();
    check(
      "8b: local_data_migrated_at remains null immediately after a successful migrateLocalData call - only markMigrationComplete (called separately, after validateMigratedData) sets it",
      successMembership.data.local_data_migrated_at === null,
    );
    await markMigrationComplete(successClient as Client, FAKE_CTX.membershipId);
    const afterMarkMembership = await successClient
      .from("organization_memberships")
      .select("local_data_migrated_at")
      .eq("id", FAKE_CTX.membershipId)
      .single();
    check("8c: markMigrationComplete, called explicitly, does set it", afterMarkMembership.data.local_data_migrated_at !== null);
  }

  // -------------------------------------------------------------------
  // 9. Ongoing save path (applyDiff / SupabaseDataRepository): editing one
  //    schedule's block never overwrites another schedule's block, even
  //    when their legacy local ids match.
  // -------------------------------------------------------------------
  console.log("\n9. SupabaseDataRepository.applyDiff never lets one schedule's block edit overwrite another schedule's block");
  {
    const scheduleA: BellSchedule = {
      id: "schedule-A",
      name: "Schedule A",
      isDefault: true,
      timeZone: "America/Detroit",
      blocks: [{ id: "block-1", label: "Old A", kind: "instructional", startTime: "08:00", endTime: "08:45", overrides: [] }],
    };
    const scheduleB: BellSchedule = {
      id: "schedule-B",
      name: "Schedule B (legacy duplicate, shares block-1's raw id)",
      isDefault: false,
      timeZone: "America/Detroit",
      blocks: [{ id: "block-1", label: "Old B", kind: "instructional", startTime: "09:00", endTime: "09:45", overrides: [] }],
    };
    const empty: AppData = { ...createDemoAppData(), schedules: [], courses: [], classSections: [] };
    const initial: AppData = { ...empty, schedules: [scheduleA, scheduleB] };

    const client = new FakeSupabaseClient(null);
    await applyDiff(client as Client, FAKE_CTX, empty, initial);

    const cloudIdA = Map_.scheduleBlockCloudId("schedule-A", "block-1");
    const cloudIdB = Map_.scheduleBlockCloudId("schedule-B", "block-1");
    check(
      "9a: sanity - the fixture really does share a raw local block id across two schedules",
      scheduleA.blocks[0].id === scheduleB.blocks[0].id,
    );
    check("9b: FIXED - the two schedules' same-raw-id blocks got distinct cloud ids", cloudIdA !== cloudIdB);
    check("9c: after creating both, schedule_blocks has exactly 2 rows, not 1", client.rowCount("schedule_blocks") === 2);
    check("9d: schedule A's row still reads 'Old A'", client.allRows("schedule_blocks").find((r) => r.id === cloudIdA)?.label === "Old A");
    check("9e: schedule B's row still reads 'Old B'", client.allRows("schedule_blocks").find((r) => r.id === cloudIdB)?.label === "Old B");

    // Now edit ONLY schedule B's block-1 - schedule A is untouched in `next`.
    const scheduleBEdited: BellSchedule = { ...scheduleB, blocks: [{ ...scheduleB.blocks[0], label: "New B" }] };
    const updated: AppData = { ...empty, schedules: [scheduleA, scheduleBEdited] };
    await applyDiff(client as Client, FAKE_CTX, initial, updated);

    check("9f: after editing only B, schedule_blocks still has exactly 2 rows (no new/duplicate row)", client.rowCount("schedule_blocks") === 2);
    check(
      "9g: FIXED - schedule A's row is completely untouched by editing schedule B's same-raw-id block",
      client.allRows("schedule_blocks").find((r) => r.id === cloudIdA)?.label === "Old A",
    );
    check("9h: schedule B's row reflects the edit", client.allRows("schedule_blocks").find((r) => r.id === cloudIdB)?.label === "New B");

    // Deletion must also target the correct scoped row, not the raw local id.
    const scheduleBNoBlocks: BellSchedule = { ...scheduleBEdited, blocks: [] };
    const afterDelete: AppData = { ...empty, schedules: [scheduleA, scheduleBNoBlocks] };
    await applyDiff(client as Client, FAKE_CTX, updated, afterDelete);
    check("9i: deleting schedule B's block-1 removes only B's row", client.allRows("schedule_blocks").find((r) => r.id === cloudIdB) === undefined);
    check(
      "9j: schedule A's same-raw-id block survives B's deletion untouched",
      client.allRows("schedule_blocks").find((r) => r.id === cloudIdA)?.label === "Old A" && client.rowCount("schedule_blocks") === 1,
    );
  }

  // -------------------------------------------------------------------
  // 10. localStorage is never touched by any of this - static source check,
  //     same pattern used elsewhere (e.g. verify-restore-backup.ts's
  //     equivalent guarantee for restoreBackup.ts).
  // -------------------------------------------------------------------
  console.log("\n10. Nothing involved in this fix ever ACCESSES localStorage (comments describing that it doesn't are fine)");
  {
    const filesToCheck = [
      "lib/data/migration/migrateLocalData.ts",
      "lib/data/supabaseMapping.ts",
      "lib/data/scopedCloudId.ts",
      "lib/data/supabaseDataRepository.ts",
    ];
    const accessPattern = /localStorage\s*[.[]|from\s+["']@\/lib\/data\/localStorageRepository["']/;
    for (const relativePath of filesToCheck) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      check(`10: ${relativePath} never accesses localStorage or imports localStorageRepository`, !accessPattern.test(source));
    }
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error running migration schedule-block-conflict verification:", error);
  process.exit(1);
});
