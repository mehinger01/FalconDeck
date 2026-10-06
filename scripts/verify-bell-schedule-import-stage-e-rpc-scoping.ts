/**
 * Offline-only verification that the Stage E corrective migration stores
 * the canonical scoped schedule_blocks.id representation
 * (lib/data/scopedCloudId.ts's scopedCloudId(parentId, localId)) rather
 * than the raw local block id written by the original Stage E RPC
 * migration (20261003195952_bell_schedule_csv_import_stage_e_rpc.sql).
 *
 * Never touches Supabase. Two layers:
 *
 *   Layer 1 - algorithmic equivalence: a local TS function mirrors the
 *   proposed SQL escaping expression character-for-character
 *   (replace(replace(x, '\', '\\'), ':', '\:') per component, joined with a
 *   literal ":") and is compared byte-for-byte against the real,
 *   already-imported scopedCloudId() for a battery of inputs, including the
 *   exact edge cases (colon/backslash in either component) that prove plain
 *   concatenation is NOT equivalent.
 *
 *   Layer 2 - static source check: reads the new migration file's SQL text
 *   and asserts the scoped-id construction, the absence of the old raw
 *   assignment, and the full security posture are all present.
 *
 * Run via `tsx`:
 *
 *   npx tsx scripts/verify-bell-schedule-import-stage-e-rpc-scoping.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scopedCloudId } from "@/lib/data/scopedCloudId";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

console.log("1-9. Layer 1: SQL-equivalent escaping matches scopedCloudId() byte-for-byte");
{
  /** Mirrors the migration's SQL expression exactly: replace(replace(x, '\', '\\'), ':', '\:') per component, joined with a literal ":". */
  function sqlEquivalentScopedId(parentId: string, localId: string): string {
    const escape = (x: string) => x.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    return `${escape(parentId)}:${escape(localId)}`;
  }

  const cases: Array<{ label: string; parentId: string; localId: string }> = [
    { label: "1: ordinary generated-style ids", parentId: "schedule-abc123", localId: "block-def456" },
    { label: "2: colon in parent", parentId: "schedule-a:b", localId: "block-1" },
    { label: "3: colon in local id", parentId: "schedule-a", localId: "block-1:2" },
    { label: "4: backslash in parent", parentId: "schedule-a\\b", localId: "block-1" },
    { label: "5: backslash in local id", parentId: "schedule-a", localId: "block-1\\2" },
    { label: "6: both colon and backslash in parent", parentId: "schedule-a:\\b", localId: "block-1" },
    { label: "7: both colon and backslash in local id", parentId: "schedule-a", localId: "block-1:\\2" },
    { label: "8: repeated escaped characters in both", parentId: "a:b:c\\d\\e", localId: "f\\g:h:i\\j" },
    { label: "9: colon and backslash adjacent (ordering sensitivity)", parentId: "a\\:b", localId: "c\\:d" },
  ];

  for (const { label, parentId, localId } of cases) {
    const expected = scopedCloudId(parentId, localId);
    const actual = sqlEquivalentScopedId(parentId, localId);
    check(`${label} (parent=${JSON.stringify(parentId)}, local=${JSON.stringify(localId)})`, actual === expected);
  }
}

console.log("\n10-17. Layer 2: static migration source checks");
{
  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/20261004184746_bell_schedule_csv_import_stage_e_scoped_block_id_fix.sql",
  );
  const source = readFileSync(migrationPath, "utf8");

  check(
    "10: targets public.import_bell_schedule via CREATE OR REPLACE FUNCTION",
    /create or replace function public\.import_bell_schedule\s*\(/i.test(source),
  );

  check(
    "11: schedule_blocks.id expression performs the required escaping/scoping",
    source.includes(
      "v_escaped_schedule_id || ':' || replace(replace(ordered.value ->> 'id', '\\', '\\\\'), ':', '\\:'),",
    ),
  );

  check(
    "12: v_escaped_schedule_id itself is computed with the same two-step escape (backslash, then colon)",
    source.includes(
      "v_escaped_schedule_id := replace(replace(p_id, '\\', '\\\\'), ':', '\\:');",
    ),
  );
  check(
    "13: the old raw id behavior is not present as the first selected value for schedule_blocks.id",
    !/select\s*\n\s*ordered\.value\s*->>\s*'id',/.test(source),
  );

  check(
    "14: bell_schedule_id still receives raw p_id (not scoped)",
    /insert into public\.schedule_blocks[\s\S]*?select[\s\S]*?\|\|\s*':'\s*\|\|[\s\S]*?,\s*\n\s*p_id,/.test(source),
  );

  check("15: revoke execute ... from public is present", /revoke execute on function public\.import_bell_schedule\([^)]*\) from public;/.test(source));
  check("16: revoke execute ... from anon is present", /revoke execute on function public\.import_bell_schedule\([^)]*\) from anon;/.test(source));
  check(
    "17a: grant execute ... to authenticated is present",
    /grant execute on function public\.import_bell_schedule\([^)]*\) to authenticated;/.test(source),
  );
  check(
    "17b: grant execute ... to postgres is present",
    /grant execute on function public\.import_bell_schedule\([^)]*\) to postgres;/.test(source),
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
