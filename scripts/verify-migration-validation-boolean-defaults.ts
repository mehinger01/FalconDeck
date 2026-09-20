/**
 * Regression coverage for a SECOND, distinct real production migration
 * failure - discovered only after the schedule_blocks id-scoping fix
 * (see verify-migration-schedule-block-conflict.ts) let migration reach
 * validateMigratedData for the first time ever on this account:
 *
 *   "Migration ran, but the cloud data doesn't match your local data
 *   yet, so nothing was marked complete. Your local data is untouched -
 *   safe to try again."
 *
 * This was UNRELATED to schedule-block id scoping. Root cause:
 * `bell_schedules.needs_configuration` and `schedule_blocks.is_lunch_window`
 * are `not null default false` columns. The forward mappers correctly
 * collapse the local optional boolean's `undefined` to `false` for that
 * NOT NULL column (`schedule.needsConfiguration ?? false`,
 * `block.isLunchWindow ?? false` - lib/data/supabaseMapping.ts). But the
 * REVERSE mapper (rowsToBellSchedule) used to copy the DB's boolean
 * straight back (`needsConfiguration: schedule.needs_configuration`,
 * `isLunchWindow: block.is_lunch_window`) instead of collapsing `false`
 * back to `undefined` - unlike every other optional field in this file
 * (e.g. `customKindLabel: block.custom_kind_label ?? undefined`).
 *
 * validateMigratedData's deepEqual treats an omitted key and the same key
 * explicitly set to `undefined` as equal, but a key present with `false`
 * is a real, different value from "absent" (see deepEqual's own key
 * filtering: `Object.keys(obj).filter((k) => obj[k] !== undefined)`).
 * Since almost every real schedule/block never sets isLunchWindow/
 * needsConfiguration true, this fired for nearly every schedule on a
 * teacher's very first successful migration - which is exactly why it
 * was never seen before this account's schedule_blocks fix finally let
 * migrateLocalData succeed and validateMigratedData actually run.
 *
 * FIX: rowsToBellSchedule now writes
 *   needsConfiguration: schedule.needs_configuration || undefined
 *   isLunchWindow: block.is_lunch_window || undefined
 * so `false` collapses back to the local canonical "omitted" form, while
 * `true` survives unchanged. This file proves that fix - and that the
 * already-written cloud rows (correct all along; this was read-side only)
 * need no cleanup and are safe to validate directly.
 *
 *   npx tsx scripts/verify-migration-validation-boolean-defaults.ts
 */

import { createOhhsRegularSchedule, OHHS_REGULAR_ID } from "@/lib/schedule/presets/ohhsRegular";
import { createOhhsEarlyRelease1124Schedule } from "@/lib/schedule/presets/needsConfigurationSchedules";
import { migrateLocalData, markMigrationComplete } from "@/lib/data/migration/migrateLocalData";
import { validateMigratedData } from "@/lib/data/migration/validateMigratedData";
import { fetchAppData } from "@/lib/data/supabaseDataRepository";
import * as Map_ from "@/lib/data/supabaseMapping";
import type { OwnerContext } from "@/lib/data/supabaseMapping";
import { createDemoAppData } from "@/lib/data/demoData";
import type { AppData } from "@/lib/data/types";
import type { BellSchedule } from "@/types/schedule";

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

/** Reproduces the PRE-FIX DUPLICATE_SCHEDULE behavior exactly - see verify-migration-schedule-block-conflict.ts for why this is the real account's actual shape. */
function legacyDuplicateSchedule(source: BellSchedule, newId: string, newName: string): BellSchedule {
  return { ...structuredClone(source), id: newId, name: newName, isDefault: false, source: "custom" };
}

// ---------------------------------------------------------------------------
// Minimal in-memory fake Supabase client - the read (`select`) surface
// fetchAppData/validateMigratedData need, in addition to the upsert surface
// verify-migration-schedule-block-conflict.ts already exercises. No
// network. No real Supabase project is touched anywhere in this file.
// ---------------------------------------------------------------------------
interface FakeRow {
  id?: string;
  [key: string]: unknown;
}

const CONFLICT_KEY_BY_TABLE: Record<string, (row: FakeRow) => string> = {
  lesson_class_sections: (row) => `${row.lesson_id}::${row.class_section_id}`,
  library_resource_courses: (row) => `${row.library_resource_id}::${row.course_id}`,
  class_presentation_settings: (row) => row.class_section_id as string,
  classroom_experience_settings: (row) => row.owner_membership_id as string,
  teacher_schedule_preferences: (row) => row.owner_membership_id as string,
};

function conflictKey(table: string, row: FakeRow): string {
  return CONFLICT_KEY_BY_TABLE[table]?.(row) ?? (row.id as string);
}

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
      if (this.filters.every(([column, value]) => row[column] === value)) this.table.delete(key);
    }
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

/** Chainable, awaitable `.select().eq().eq().order().order()`, plus `.single()`/`.maybeSingle()`. */
class FakeSelectBuilder implements PromiseLike<{ data: FakeRow[]; error: null }> {
  private filters: Array<[string, string]> = [];
  constructor(private rows: FakeRow[]) {}

  eq(column: string, value: string): this {
    this.filters.push([column, value]);
    return this;
  }

  order(): this {
    return this; // ordering doesn't affect correctness here - validateMigratedData normalizes/sorts itself
  }

  private filtered(): FakeRow[] {
    return this.rows.filter((row) => this.filters.every(([column, value]) => row[column] === value));
  }

  async single() {
    return { data: this.filtered()[0] ?? null, error: null };
  }

  async maybeSingle() {
    return { data: this.filtered()[0] ?? null, error: null };
  }

  then<TResult1 = { data: FakeRow[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: FakeRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.filtered(), error: null }).then(onfulfilled, onrejected);
  }
}

class FakeSupabaseClient {
  private tables = new Map<string, Map<string, FakeRow>>();
  private membership: { local_data_migrated_at: string | null } = { local_data_migrated_at: null };

  rowCount(table: string): number {
    return this.tables.get(table)?.size ?? 0;
  }

  private tableFor(name: string): Map<string, FakeRow> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  seed(table: string, rows: FakeRow[]) {
    const t = this.tableFor(table);
    for (const row of rows) t.set(conflictKey(table, row), row);
  }

  from(name: string) {
    const table = this.tableFor(name);
    const membership = this.membership;
    if (name === "organization_memberships") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { local_data_migrated_at: membership.local_data_migrated_at }, error: null }),
          }),
        }),
        update: (patch: { local_data_migrated_at?: string }) => ({
          eq: () => {
            if (patch.local_data_migrated_at !== undefined) membership.local_data_migrated_at = patch.local_data_migrated_at;
            return Promise.resolve({ data: null, error: null });
          },
        }),
      };
    }
    return {
      select: (_cols: string) => new FakeSelectBuilder([...table.values()]),
      upsert: async (rowsOrRow: FakeRow | FakeRow[]) => {
        const rows = Array.isArray(rowsOrRow) ? rowsOrRow : [rowsOrRow];
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
  // 1. Legacy duplicated-schedule snapshot migrates successfully, and
  //    (7) validateMigratedData now PASSES after migration - the exact
  //    real production incident, now fixed end to end.
  // -------------------------------------------------------------------
  console.log("1 & 7. Full migrateLocalData -> validateMigratedData pipeline against a legacy duplicated-schedule snapshot");
  let mainClient!: FakeSupabaseClient;
  let mainSnapshot!: AppData;
  {
    const ohhs = createOhhsRegularSchedule();
    const legacyCopy = legacyDuplicateSchedule(ohhs, "schedule-mike-ehinger-regular-day", "Mike Ehinger - Regular Day");
    const snapshot: AppData = { ...createDemoAppData(), schedules: [ohhs, legacyCopy] };
    mainSnapshot = snapshot;
    const client = new FakeSupabaseClient();
    mainClient = client;

    const migrateResult = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    check("1: migrateLocalData succeeds against the legacy duplicated-schedule snapshot", migrateResult.ok === true);

    if (migrateResult.ok) {
      const validateResult = await validateMigratedData(client as Client, FAKE_CTX, snapshot, migrateResult);
      check("7: FIXED - validateMigratedData now reports success (no more false mismatch)", validateResult.ok === true);
      if (!validateResult.ok) console.log("    mismatches:", JSON.stringify(validateResult.mismatches, null, 2));
    }
  }

  // -------------------------------------------------------------------
  // 2. Scoped schedule block ids round-trip correctly (still true after
  //    this second fix - proves the two fixes don't interfere).
  // -------------------------------------------------------------------
  console.log("\n2. Scoped schedule-block ids still round-trip correctly");
  {
    const reloaded = await fetchAppData(mainClient as Client, FAKE_CTX);
    for (const expectedSchedule of mainSnapshot.schedules) {
      const actualSchedule = reloaded.schedules.find((s) => s.id === expectedSchedule.id);
      const expectedIds = [...expectedSchedule.blocks.map((b) => b.id)].sort();
      const actualIds = [...(actualSchedule?.blocks.map((b) => b.id) ?? [])].sort();
      check(`2: schedule ${expectedSchedule.id}'s block ids round-trip exactly`, JSON.stringify(expectedIds) === JSON.stringify(actualIds));
    }
  }

  // -------------------------------------------------------------------
  // 3-4. isLunchWindow: true survives as true; false round-trips to
  //      omitted/undefined (not a real false value).
  // -------------------------------------------------------------------
  console.log("\n3-4. isLunchWindow: true survives as true; false round-trips to omitted/undefined");
  {
    const reloaded = await fetchAppData(mainClient as Client, FAKE_CTX);
    const actualOhhs = reloaded.schedules.find((s) => s.id === OHHS_REGULAR_ID)!;
    const localOhhs = mainSnapshot.schedules.find((s) => s.id === OHHS_REGULAR_ID)!;

    const lunchBlockLocal = localOhhs.blocks.find((b) => b.isLunchWindow === true)!;
    const lunchBlockReloaded = actualOhhs.blocks.find((b) => b.id === lunchBlockLocal.id)!;
    check("3: the true lunch-window block survives as isLunchWindow === true", lunchBlockReloaded.isLunchWindow === true);

    const nonLunchBlockLocal = localOhhs.blocks.find((b) => !("isLunchWindow" in b))!;
    const nonLunchBlockReloaded = actualOhhs.blocks.find((b) => b.id === nonLunchBlockLocal.id)!;
    check("4a: FIXED - isLunchWindow reads as undefined for a non-lunch block, not false", nonLunchBlockReloaded.isLunchWindow === undefined);
    check(
      "4b: FIXED - deepEqual now treats the truly-omitted local key and the reloaded undefined key as equal (this is exactly what validateMigratedData relies on)",
      Map_.deepEqual(nonLunchBlockLocal, nonLunchBlockReloaded),
    );
  }

  // -------------------------------------------------------------------
  // 5-6. needsConfiguration: true survives as true; false round-trips to
  //      omitted/undefined.
  // -------------------------------------------------------------------
  console.log("\n5-6. needsConfiguration: true survives as true; false round-trips to omitted/undefined");
  {
    const needsConfigSchedule = createOhhsEarlyRelease1124Schedule(); // needsConfiguration: true, blocks: []
    const ohhs = createOhhsRegularSchedule(); // needsConfiguration never set (locally omitted)
    const snapshot: AppData = { ...createDemoAppData(), schedules: [needsConfigSchedule, ohhs] };
    const client = new FakeSupabaseClient();
    const migrateResult = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    if (!migrateResult.ok) throw new Error("setup failure: expected migrateLocalData to succeed");
    const reloaded = await fetchAppData(client as Client, FAKE_CTX);

    const reloadedNeedsConfig = reloaded.schedules.find((s) => s.id === needsConfigSchedule.id)!;
    check("5: the true needsConfiguration schedule survives as needsConfiguration === true", reloadedNeedsConfig.needsConfiguration === true);

    const reloadedOhhs = reloaded.schedules.find((s) => s.id === OHHS_REGULAR_ID)!;
    check("6a: FIXED - needsConfiguration reads as undefined for a schedule that never set it, not false", reloadedOhhs.needsConfiguration === undefined);
    check(
      "6b: FIXED - deepEqual now treats the truly-omitted local needsConfiguration and the reloaded undefined as equal",
      Map_.deepEqual(ohhs, reloadedOhhs),
    );

    const validateResult = await validateMigratedData(client as Client, FAKE_CTX, snapshot, migrateResult);
    check("7 (mixed true/false case): validateMigratedData passes with a genuine needsConfiguration:true schedule present too", validateResult.ok === true);
  }

  // -------------------------------------------------------------------
  // 8. No other schedule/block fields are altered by this fix - every
  //    other field still round-trips exactly (the fix is scoped to
  //    exactly these two booleans).
  // -------------------------------------------------------------------
  console.log("\n8. No other schedule/block fields are altered by this fix");
  {
    const reloaded = await fetchAppData(mainClient as Client, FAKE_CTX);
    const actualOhhs = reloaded.schedules.find((s) => s.id === OHHS_REGULAR_ID)!;
    const localOhhs = mainSnapshot.schedules.find((s) => s.id === OHHS_REGULAR_ID)!;
    check(
      "8a: schedule-level fields other than needsConfiguration are unchanged",
      actualOhhs.name === localOhhs.name &&
        actualOhhs.timeZone === localOhhs.timeZone &&
        actualOhhs.isDefault === localOhhs.isDefault &&
        actualOhhs.source === localOhhs.source,
    );
    const sortedLocal = [...localOhhs.blocks].sort((a, b) => a.id.localeCompare(b.id));
    const sortedActual = [...actualOhhs.blocks].sort((a, b) => a.id.localeCompare(b.id));
    check(
      "8b: every block's label/kind/customKindLabel/startTime/endTime/classSectionId is unchanged",
      sortedLocal.every(
        (b, i) =>
          b.label === sortedActual[i].label &&
          b.kind === sortedActual[i].kind &&
          b.customKindLabel === sortedActual[i].customKindLabel &&
          b.startTime === sortedActual[i].startTime &&
          b.endTime === sortedActual[i].endTime &&
          (b.classSectionId ?? null) === (sortedActual[i].classSectionId ?? null),
      ),
    );
    check("8c: Map_.deepEqual now considers each full block equal (proves nothing else diverges)", sortedLocal.every((b, i) => Map_.deepEqual(b, sortedActual[i])));
  }

  // -------------------------------------------------------------------
  // 9. The current partial cloud state (courses/class_sections/
  //    bell_schedules already present from a first attempt, exactly the
  //    real stuck org's shape) is safe for direct retry with the fix.
  // -------------------------------------------------------------------
  console.log("\n9. A partially-migrated cloud state is safe for direct retry with the fix applied");
  {
    const ohhs = createOhhsRegularSchedule();
    const legacyCopy = legacyDuplicateSchedule(ohhs, "schedule-mike-ehinger-regular-day", "Mike Ehinger - Regular Day");
    const snapshot: AppData = { ...createDemoAppData(), schedules: [ohhs, legacyCopy] };
    const client = new FakeSupabaseClient();
    // Pre-seed exactly what a first partial attempt already committed.
    client.seed("courses", snapshot.courses.map((c) => Map_.courseToRow(c, FAKE_CTX)));
    client.seed("class_sections", snapshot.classSections.map((s) => Map_.classSectionToRow(s, FAKE_CTX)));
    client.seed("bell_schedules", snapshot.schedules.map((s) => Map_.bellScheduleToRow(s, FAKE_CTX)));

    const migrateResult = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    check("9a: migration completes fully against the pre-populated partial state", migrateResult.ok === true);
    if (migrateResult.ok) {
      const validateResult = await validateMigratedData(client as Client, FAKE_CTX, snapshot, migrateResult);
      check("9b: validation passes on this retried, previously-partial org", validateResult.ok === true);
    }
    check("9c: courses did not grow beyond the real distinct count (idempotent)", client.rowCount("courses") === snapshot.courses.length);
    check("9d: bell_schedules did not grow beyond the real distinct count (idempotent)", client.rowCount("bell_schedules") === snapshot.schedules.length);
  }

  // -------------------------------------------------------------------
  // 10. local_data_migrated_at remains unset until validation succeeds -
  //     migrateLocalData and validateMigratedData never write it; only
  //     an explicit, separate markMigrationComplete call does.
  // -------------------------------------------------------------------
  console.log("\n10. local_data_migrated_at remains unset until validation succeeds");
  {
    const ohhs = createOhhsRegularSchedule();
    const snapshot: AppData = { ...createDemoAppData(), schedules: [ohhs] };
    const client = new FakeSupabaseClient();

    const migrateResult = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    const afterMigrate = await client.from("organization_memberships").select("local_data_migrated_at").eq("id", FAKE_CTX.membershipId).single();
    check("10a: unset immediately after migrateLocalData succeeds", (afterMigrate as { data: { local_data_migrated_at: string | null } }).data.local_data_migrated_at === null);

    if (migrateResult.ok) {
      const validateResult = await validateMigratedData(client as Client, FAKE_CTX, snapshot, migrateResult);
      const afterValidate = await client.from("organization_memberships").select("local_data_migrated_at").eq("id", FAKE_CTX.membershipId).single();
      check("10b: still unset immediately after a passing validateMigratedData (only an explicit call sets it)", (afterValidate as { data: { local_data_migrated_at: string | null } }).data.local_data_migrated_at === null);
      check("10c: validation did in fact pass, so marking complete is now appropriate", validateResult.ok === true);

      await markMigrationComplete(client as Client, FAKE_CTX.membershipId);
      const afterMark = await client.from("organization_memberships").select("local_data_migrated_at").eq("id", FAKE_CTX.membershipId).single();
      check("10d: set only after the explicit markMigrationComplete call", (afterMark as { data: { local_data_migrated_at: string | null } }).data.local_data_migrated_at !== null);
    }
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error running migration validation boolean-default verification:", error);
  process.exit(1);
});
