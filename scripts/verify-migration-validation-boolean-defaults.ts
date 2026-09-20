/**
 * Regression coverage for TWO related real production migration
 * failures, both discovered only after the schedule_blocks id-scoping
 * fix (see verify-migration-schedule-block-conflict.ts) let migration
 * reach validateMigratedData for the first time ever on this account:
 *
 *   "Migration ran, but the cloud data doesn't match your local data
 *   yet, so nothing was marked complete. Your local data is untouched -
 *   safe to try again."
 *
 * Both were UNRELATED to schedule-block id scoping. Root cause:
 * `bell_schedules.needs_configuration` and `schedule_blocks.is_lunch_window`
 * are `not null default false` columns. The forward mappers correctly
 * collapse the local optional boolean's `undefined` to `false` for that
 * NOT NULL column (`schedule.needsConfiguration ?? false`,
 * `block.isLunchWindow ?? false` - lib/data/supabaseMapping.ts). That
 * write is inherently LOSSY: a local value that was genuinely omitted
 * and one that was explicitly `false` both collapse to the exact same
 * DB value, so no single reverse-mapping direction can correctly
 * reconstruct which one it originally was.
 *
 * FAILURE 1 (fixed first): the reverse mapper (rowsToBellSchedule) used
 * to copy the DB boolean straight back, so an omitted local value came
 * back as an explicit `false` - a real, different value from "absent"
 * under validateMigratedData's deepEqual (which filters out
 * `undefined`-valued keys, but `false` is real). Almost every real
 * schedule/block omits these fields, so this fired on nearly every
 * schedule.
 *
 * FAILURE 2 (this account's actual remaining case): reducer.ts's
 * DUPLICATE_SCHEDULE case used to write an EXPLICIT `needsConfiguration:
 * false` literal onto every duplicated schedule, not just ones that
 * genuinely needed it cleared. Fixing FAILURE 1 by coercing the reverse
 * mapper toward `undefined` then broke THIS shape: a real, deliberate
 * local `false` now read back as `undefined`, a mismatch in the other
 * direction. Since the forward write is lossy, no reverse-mapping choice
 * can satisfy both an omitted-local and a false-local origin.
 *
 * FINAL FIX: validateMigratedData's own normalize() now canonicalizes
 * needsConfiguration/isLunchWindow identically on BOTH the expected
 * (local) and actual (reloaded) sides before comparing - `false` and
 * omitted are treated as equivalent for exactly these two fields, on
 * both sides, so it no longer matters which shape either side has.
 * `true` is untouched and still must survive as `true`. No other field
 * is affected - deepEqual itself is NOT changed, and false/undefined are
 * NOT treated as equivalent anywhere else. reducer.ts's DUPLICATE_SCHEDULE
 * also now clears the field to `undefined` instead of `false`, so future
 * duplicates stop manufacturing this shape in the first place (this does
 * not, and cannot, retroactively fix already-saved local data - that's
 * what the symmetric normalize() fix is for).
 *
 *   npx tsx scripts/verify-migration-validation-boolean-defaults.ts
 */

import { appDataReducer } from "@/lib/store/reducer";
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

  allRows(table: string): FakeRow[] {
    return [...(this.tables.get(table)?.values() ?? [])];
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

    const reMigrate = await migrateLocalData(mainClient as Client, FAKE_CTX, mainSnapshot); // idempotent re-run, just to get a fresh MigrationResult for validation
    if (reMigrate.ok) {
      const validateOmittedResult = await validateMigratedData(mainClient as Client, FAKE_CTX, mainSnapshot, reMigrate);
      check("5: omitted local isLunchWindow validates successfully end to end", validateOmittedResult.ok === true);
    }
  }

  // -------------------------------------------------------------------
  // 4c/6. isLunchWindow: EXPLICIT local false (not omitted) also
  //       validates successfully - the mirror case to needsConfiguration
  //       below, proven with the actual validateMigratedData pipeline,
  //       not just fetchAppData.
  // -------------------------------------------------------------------
  console.log("\n4c/6. isLunchWindow: EXPLICIT local false (not omitted) validates successfully; true still survives as true");
  {
    const scheduleWithExplicitFalse: BellSchedule = {
      id: "schedule-explicit-lunch-false",
      name: "Explicit isLunchWindow false",
      isDefault: false,
      timeZone: "America/Detroit",
      source: "custom",
      blocks: [
        { id: "block-explicit-false", label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: null, isLunchWindow: false, overrides: [] },
        { id: "block-true", label: "Lunch Period", kind: "instructional", startTime: "12:00", endTime: "12:50", classSectionId: null, isLunchWindow: true, overrides: [] },
      ],
    };
    const snapshot: AppData = { ...createDemoAppData(), schedules: [scheduleWithExplicitFalse] };
    const client = new FakeSupabaseClient();
    const migrateResult = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    if (!migrateResult.ok) throw new Error("setup failure: expected migrateLocalData to succeed");

    const reloaded = await fetchAppData(client as Client, FAKE_CTX);
    const reloadedSchedule = reloaded.schedules.find((s) => s.id === scheduleWithExplicitFalse.id)!;
    const reloadedTrueBlock = reloadedSchedule.blocks.find((b) => b.id === "block-true")!;
    check("6: FIXED - a block with explicit local isLunchWindow: true still survives and validates as true", reloadedTrueBlock.isLunchWindow === true);

    const validateResult = await validateMigratedData(client as Client, FAKE_CTX, snapshot, migrateResult);
    check(
      "4c: FIXED - a block with EXPLICIT local isLunchWindow: false (not omitted) now validates successfully against cloud reload undefined",
      validateResult.ok === true,
    );
    if (!validateResult.ok) console.log("    mismatches:", JSON.stringify(validateResult.mismatches));
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

  // -------------------------------------------------------------------
  // 11. The real teacher's actual remaining shape (FAILURE 2, see header):
  //     a schedule where DUPLICATE_SCHEDULE's OLD object literal
  //     explicitly wrote `needsConfiguration: false` on the duplicate.
  //     FIXED by validateMigratedData's symmetric normalize().
  // -------------------------------------------------------------------
  console.log("\n11. FIXED: a schedule with EXPLICIT needsConfiguration: false (not omitted) - the real teacher's exact remaining shape");
  {
    // Minimal, synthetic - not the real teacher's schedule/course/section
    // names or ids, just the smallest shape that reproduces the mismatch:
    // a schedule whose local needsConfiguration is a real `false`, exactly
    // as DUPLICATE_SCHEDULE's reducer literal still produces today.
    const sourceSchedule: BellSchedule = {
      id: "schedule-source",
      name: "Source Schedule",
      isDefault: false,
      timeZone: "America/Detroit",
      source: "built-in",
      // classSectionId: null (not omitted) matches the real app's own
      // convention (see lib/schedule/presets/ohhsRegular.ts) - keeps this
      // fixture isolated to the one field under test.
      blocks: [{ id: "block-a", label: "Period A", kind: "instructional", startTime: "08:00", endTime: "08:50", classSectionId: null, overrides: [] }],
    };
    // Exactly reducer.ts's DUPLICATE_SCHEDULE object literal, including
    // its still-present `needsConfiguration: false` - not a hypothetical.
    const duplicatedSchedule: BellSchedule = {
      ...structuredClone(sourceSchedule),
      id: "schedule-duplicate",
      name: "Source Schedule (Copy)",
      isDefault: false,
      source: "custom",
      needsConfiguration: false,
      blocks: sourceSchedule.blocks.map((b) => ({ ...b, id: `${b.id}-copy` })),
    };

    check("11a: sanity - the fixture's duplicate really does have an EXPLICIT needsConfiguration: false, not omitted", duplicatedSchedule.needsConfiguration === false);

    const snapshot: AppData = { ...createDemoAppData(), schedules: [sourceSchedule, duplicatedSchedule] };
    const client = new FakeSupabaseClient();
    const migrateResult = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    check("11b: migration itself still succeeds (this is a validation-only defect)", migrateResult.ok === true);

    if (migrateResult.ok) {
      const validateResult = await validateMigratedData(client as Client, FAKE_CTX, snapshot, migrateResult);
      check(
        "11c: FIXED - explicit local needsConfiguration: false now validates successfully against cloud reload undefined",
        validateResult.ok === true,
      );
      if (!validateResult.ok) console.log("    mismatches:", JSON.stringify(validateResult.mismatches));
    }
  }

  // -------------------------------------------------------------------
  // 12. Reducer hygiene fix: DUPLICATE_SCHEDULE no longer manufactures an
  //     explicit needsConfiguration: false on ordinary duplicates, but
  //     still clears a genuine needs-configuration source's flag - and
  //     preserves every other property, the new schedule id, and
  //     regenerated nested block/override ids.
  // -------------------------------------------------------------------
  console.log("\n12. FIXED: DUPLICATE_SCHEDULE stops manufacturing explicit needsConfiguration: false");
  {
    const ohhs = createOhhsRegularSchedule();
    const base = { ...createDemoAppData(), schedules: [ohhs] };
    const withDuplicate = appDataReducer(base, {
      type: "DUPLICATE_SCHEDULE",
      scheduleId: OHHS_REGULAR_ID,
      newId: "schedule-fresh-duplicate",
      newName: "OHHS Regular Day (Copy)",
    });
    const duplicate = withDuplicate.schedules.find((s) => s.id === "schedule-fresh-duplicate")!;
    check("12a: FIXED - duplicating an ordinary schedule no longer sets needsConfiguration to a literal false", duplicate.needsConfiguration !== false);
    check("12b: needsConfiguration is undefined (omitted), matching the local canonical convention", duplicate.needsConfiguration === undefined);
    check("12c: the new schedule gets a fresh id, distinct from the source", duplicate.id === "schedule-fresh-duplicate" && duplicate.id !== ohhs.id);
    check(
      "12d: every nested block/override still gets a fresh id (the earlier hygiene fix is untouched)",
      duplicate.blocks.every((b) => !ohhs.blocks.some((ob) => ob.id === b.id)),
    );
    check(
      "12e: all other properties (name/timeZone/blocks content) are preserved from the source",
      duplicate.timeZone === ohhs.timeZone &&
        duplicate.blocks.length === ohhs.blocks.length &&
        duplicate.blocks.every((b, i) => b.label === ohhs.blocks[i].label && b.startTime === ohhs.blocks[i].startTime),
    );
    check("12f: the source itself is untouched (still has its own original id/needsConfiguration state)", ohhs.id === OHHS_REGULAR_ID && !("needsConfiguration" in ohhs));

    // Duplicating a GENUINE needs-configuration placeholder must still clear the flag - that part of the original behavior is preserved.
    const needsConfigSource = createOhhsEarlyRelease1124Schedule();
    const baseWithNeedsConfig = { ...createDemoAppData(), schedules: [needsConfigSource] };
    const withNeedsConfigDuplicate = appDataReducer(baseWithNeedsConfig, {
      type: "DUPLICATE_SCHEDULE",
      scheduleId: needsConfigSource.id,
      newId: "schedule-needs-config-duplicate",
      newName: "Early Release (Copy)",
    });
    const needsConfigDuplicate = withNeedsConfigDuplicate.schedules.find((s) => s.id === "schedule-needs-config-duplicate")!;
    check(
      "12g: duplicating a genuine needs-configuration schedule still clears the flag (undefined, not true, not a manufactured false)",
      needsConfigDuplicate.needsConfiguration === undefined,
    );
    check("12h: the needs-configuration source itself is untouched (still true)", needsConfigSource.needsConfiguration === true);
  }

  // -------------------------------------------------------------------
  // 13. No unrelated false/undefined field is normalized - the
  //     validateMigratedData fix is scoped to exactly needsConfiguration/
  //     isLunchWindow, nothing else.
  // -------------------------------------------------------------------
  console.log("\n13. No unrelated field is normalized - a genuine, unrelated divergence is still caught");
  {
    const ohhs = createOhhsRegularSchedule();
    const snapshot: AppData = { ...createDemoAppData(), schedules: [ohhs] };
    const client = new FakeSupabaseClient();
    const migrateResult = await migrateLocalData(client as Client, FAKE_CTX, snapshot);
    if (!migrateResult.ok) throw new Error("setup failure: expected migrateLocalData to succeed");

    // Directly corrupt an UNRELATED field on one already-written row -
    // simulating any real divergence that has nothing to do with
    // needsConfiguration/isLunchWindow - and confirm validation still
    // reports it, proving the fix did not weaken validation generally.
    const rows = [...client.allRows("schedule_blocks")];
    const target = rows.find((r) => (r.id as string).endsWith("period-1"))!;
    client.seed("schedule_blocks", [{ ...target, label: "TAMPERED LABEL" }]);

    const validateResult = await validateMigratedData(client as Client, FAKE_CTX, snapshot, migrateResult);
    check("13a: an unrelated field divergence (label) is still detected, not silently swallowed", validateResult.ok === false);
    check(
      "13b: the reported mismatch is on the schedule containing the tampered block, not a false negative",
      !validateResult.ok && validateResult.mismatches.some((m) => m.entity === "schedules" && m.detail.includes(OHHS_REGULAR_ID)),
    );

    // Restore and confirm a clean re-migrate/validate still passes -
    // proves the corruption check above wasn't itself a false positive
    // from some other cause.
    client.seed("schedule_blocks", [target]);
    const revalidated = await validateMigratedData(client as Client, FAKE_CTX, snapshot, migrateResult);
    check("13c: sanity - restoring the tampered field makes validation pass again", revalidated.ok === true);
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error running migration validation boolean-default verification:", error);
  process.exit(1);
});
