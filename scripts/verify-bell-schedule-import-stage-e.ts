/**
 * Standalone verification for Stage E's Bell Schedule CSV Import parser
 * (`lib/schedule/bellScheduleImport.ts`). Not a test framework - a script
 * with assertions, run via `tsx`:
 *
 *   npx tsx scripts/verify-bell-schedule-import-stage-e.ts
 *
 * Covers parseBellScheduleCsv, findScheduleNameConflict, and
 * buildBellScheduleImportPayload - everything in that module is pure (no
 * React, no Supabase, no lib/store), so it's exercised directly here,
 * matching this project's established verify-*.ts pattern (see
 * scripts/verify-lesson-import.ts). The final section below is a static-
 * source check against BellScheduleImportPanel.tsx itself (same pattern as
 * verify-lesson-import.ts's own scenario 18) - this repo has no component-
 * rendering test harness, so "the UI never dispatches the ordinary AppData
 * path and only reloads after a confirmed RPC success" is verified by
 * inspecting the component's source text rather than rendering it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildBellScheduleImportPayload,
  findScheduleNameConflict,
  parseBellScheduleCsv,
  type ParsedBellScheduleBlock,
} from "@/lib/schedule/bellScheduleImport";
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

function firstMessage(result: ReturnType<typeof parseBellScheduleCsv>): string {
  return !result.ok ? (result.issues[0]?.message ?? "") : "";
}

console.log("1-16. Valid parsing");
{
  const basicCsv = [
    "schedule_name,block_name,block_type,start_time,end_time",
    "Regular Day,Period 1,class,08:00,08:50",
    "Regular Day,Passing,passing,08:50,08:55",
    "Regular Day,Period 2,class,08:55,09:45",
    "Regular Day,Lunch,lunch,09:45,10:15",
    "Regular Day,Enrichment,enrichment,10:15,10:45",
    "Regular Day,Prep,prep,10:45,11:35",
    "Regular Day,Period 3,class,11:35,12:25",
  ].join("\n");

  console.log("  1. basic valid CSV");
  {
    const result = parseBellScheduleCsv(basicCsv);
    check("1a: parses ok", result.ok === true);
    check("1b: schedule name", result.ok && result.scheduleName === "Regular Day");
    check("1c: 7 blocks", result.ok && result.blocks.length === 7);
  }

  console.log("  2. UTF-8 BOM");
  {
    const result = parseBellScheduleCsv("\uFEFF" + basicCsv);
    check("2a: parses ok despite BOM", result.ok === true);
    check("2b: schedule name unaffected by BOM", result.ok && result.scheduleName === "Regular Day");
  }

  console.log("  3. Reordered headers");
  {
    const reordered = [
      "block_name,start_time,end_time,block_type,schedule_name",
      "Period 1,08:00,08:50,class,Regular Day",
      "Period 2,08:55,09:45,class,Regular Day",
    ].join("\n");
    const result = parseBellScheduleCsv(reordered);
    check("3a: parses ok with reordered headers", result.ok === true);
    check("3b: schedule name read correctly", result.ok && result.scheduleName === "Regular Day");
    check("3c: block name read correctly", result.ok && result.blocks[0]?.label === "Period 1");
  }

  console.log("  4-8. block_type -> BlockKind mapping");
  {
    const result = parseBellScheduleCsv(basicCsv);
    const byLabel = (label: string) => (result.ok ? result.blocks.find((b) => b.label === label) : undefined);
    check("4: class -> instructional", byLabel("Period 1")?.kind === "instructional");
    check("5: passing -> passing", byLabel("Passing")?.kind === "passing");
    check("6: lunch -> lunch", byLabel("Lunch")?.kind === "lunch");
    check("7: prep -> prep", byLabel("Prep")?.kind === "prep");
    check("8: enrichment -> enrichment", byLabel("Enrichment")?.kind === "enrichment");
  }

  console.log("  9. Out-of-order rows return chronological blocks");
  {
    const outOfOrder = [
      "schedule_name,block_name,block_type,start_time,end_time",
      "Regular Day,Period 2,class,08:55,09:45",
      "Regular Day,Period 1,class,08:00,08:50",
      "Regular Day,Passing,passing,08:50,08:55",
    ].join("\n");
    const result = parseBellScheduleCsv(outOfOrder);
    check("9a: parses ok", result.ok === true);
    check(
      "9b: blocks returned in chronological order regardless of file order",
      result.ok && result.blocks.map((b) => b.label).join(",") === "Period 1,Passing,Period 2",
    );
  }

  console.log("  10. Gaps are allowed");
  {
    const withGap = [
      "schedule_name,block_name,block_type,start_time,end_time",
      "Regular Day,Period 1,class,08:00,08:50",
      "Regular Day,Period 2,class,09:00,09:50",
    ].join("\n");
    const result = parseBellScheduleCsv(withGap);
    check("10: a gap between blocks is not an error", result.ok === true);
  }

  console.log("  11-12. Time formats");
  {
    const hour24 = parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,class,08:00,08:50"].join("\n"),
    );
    check("11: 24-hour HH:MM accepted", hour24.ok === true && hour24.ok && hour24.blocks[0].startTime === "08:00");

    const ampm = parseBellScheduleCsv(
      [
        "schedule_name,block_name,block_type,start_time,end_time",
        "Regular Day,Period 1,class,8:00 AM,8:50 AM",
        "Regular Day,Period 2,class,8:55 AM,9:45 AM",
      ].join("\n"),
    );
    check("12a: AM/PM input accepted", ampm.ok === true);
    check("12b: AM/PM normalized to 24h HH:MM", ampm.ok && ampm.blocks[0].startTime === "08:00" && ampm.blocks[0].endTime === "08:50");
  }

  console.log("  13. block_type matching is case-insensitive");
  {
    const mixedCase = [
      "schedule_name,block_name,block_type,start_time,end_time",
      "Regular Day,Period 1,CLASS,08:00,08:50",
      "Regular Day,Period 2,Class,08:55,09:45",
    ].join("\n");
    const result = parseBellScheduleCsv(mixedCase);
    check("13: CLASS/Class both map to instructional", result.ok === true && result.blocks.every((b) => b.kind === "instructional"));
  }

  console.log("  14-16. Quoting");
  {
    const quotedScheduleName = [
      "schedule_name,block_name,block_type,start_time,end_time",
      '"Regular Day, Assembly",Period 1,class,08:00,08:50',
      '"Regular Day, Assembly",Period 2,class,08:55,09:45',
    ].join("\n");
    const r14 = parseBellScheduleCsv(quotedScheduleName);
    check("14: quoted schedule_name containing a comma parses correctly", r14.ok === true && r14.scheduleName === "Regular Day, Assembly");

    const quotedBlockName = [
      "schedule_name,block_name,block_type,start_time,end_time",
      'Regular Day,"Period 1, Extended",class,08:00,08:50',
      "Regular Day,Period 2,class,08:55,09:45",
    ].join("\n");
    const r15 = parseBellScheduleCsv(quotedBlockName);
    check("15: quoted block_name containing a comma parses correctly", r15.ok === true && r15.blocks[0]?.label === "Period 1, Extended");

    const escapedQuote = [
      "schedule_name,block_name,block_type,start_time,end_time",
      'Regular Day,"Period ""One""",class,08:00,08:50',
      "Regular Day,Period 2,class,08:55,09:45",
    ].join("\n");
    const r16 = parseBellScheduleCsv(escapedQuote);
    check('16: escaped "" inside a quoted field becomes a literal quote', r16.ok === true && r16.blocks[0]?.label === 'Period "One"');
  }
}

console.log("\n17-35. Invalid parsing");
{
  console.log("  17. Empty file");
  check("17: empty string is rejected", parseBellScheduleCsv("").ok === false);

  console.log("  18. Header only / no data rows");
  check(
    "18: a file with only a header row is rejected",
    parseBellScheduleCsv("schedule_name,block_name,block_type,start_time,end_time").ok === false,
  );

  console.log("  19. Missing required header");
  {
    const result = parseBellScheduleCsv(
      ["block_name,block_type,start_time,end_time", "Period 1,class,08:00,08:50"].join("\n"),
    );
    check("19a: rejected", result.ok === false);
    check("19b: names the missing column", firstMessage(result).includes("schedule_name"));
  }

  console.log("  20. Duplicate required header");
  {
    const result = parseBellScheduleCsv(
      [
        "schedule_name,schedule_name,block_name,block_type,start_time,end_time",
        "Regular Day,Regular Day,Period 1,class,08:00,08:50",
      ].join("\n"),
    );
    check("20a: rejected", result.ok === false);
    check("20b: names the duplicated column", firstMessage(result).toLowerCase().includes("duplicate"));
  }

  console.log("  21. Unexpected/extra named header rejected (exact 5-column schema)");
  {
    const result = parseBellScheduleCsv(
      [
        "schedule_name,block_name,block_type,start_time,end_time,owner_id",
        "Regular Day,Period 1,class,08:00,08:50,abc",
      ].join("\n"),
    );
    check("21a: rejected", result.ok === false);
    check("21b: reports the expected column count", firstMessage(result).includes("Expected exactly 5 columns"));
  }

  console.log("  22. Trailing blank sixth-column rejected");
  {
    const result = parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time,", "Regular Day,Period 1,class,08:00,08:50,"].join("\n"),
    );
    check("22: a trailing delimiter producing a 6th blank column is rejected", result.ok === false);
  }

  console.log("  23. Blank schedule_name");
  {
    const result = parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", ",Period 1,class,08:00,08:50"].join("\n"),
    );
    check("23a: rejected", result.ok === false);
    check("23b: names the blank schedule_name", firstMessage(result).includes("schedule_name is blank"));
  }

  console.log("  24. More than one distinct schedule_name");
  {
    const result = parseBellScheduleCsv(
      [
        "schedule_name,block_name,block_type,start_time,end_time",
        "Regular Day,Period 1,class,08:00,08:50",
        "Other Day,Period 2,class,08:55,09:45",
      ].join("\n"),
    );
    check("24: a second distinct schedule_name is rejected", result.ok === false);
  }

  console.log("  25. Blank block_name");
  {
    const result = parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,,class,08:00,08:50"].join("\n"),
    );
    check("25a: rejected", result.ok === false);
    check("25b: names the blank block_name", firstMessage(result).includes("block_name is blank"));
  }

  console.log("  26. Invalid block_type");
  {
    const result = parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,recess,08:00,08:50"].join("\n"),
    );
    check("26: an unrecognized block_type is rejected", result.ok === false);
  }

  console.log("  27. Invalid start_time");
  check(
    "27: an unparseable start_time is rejected",
    parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,class,not-a-time,08:50"].join("\n"),
    ).ok === false,
  );

  console.log("  28. Invalid end_time");
  check(
    "28: an unparseable end_time is rejected",
    parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,class,08:00,not-a-time"].join("\n"),
    ).ok === false,
  );

  console.log("  29. end_time equal to start_time");
  check(
    "29: end_time === start_time is rejected",
    parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,class,08:00,08:00"].join("\n"),
    ).ok === false,
  );

  console.log("  30. end_time before start_time");
  check(
    "30: end_time < start_time is rejected",
    parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,class,09:00,08:00"].join("\n"),
    ).ok === false,
  );

  console.log("  31. Overlapping blocks");
  check(
    "31: overlapping blocks are rejected",
    parseBellScheduleCsv(
      [
        "schedule_name,block_name,block_type,start_time,end_time",
        "Regular Day,Period 1,class,08:00,09:00",
        "Regular Day,Period 2,class,08:50,09:40",
      ].join("\n"),
    ).ok === false,
  );

  console.log("  32. Two blocks with the same start time");
  check(
    "32: a shared start_time is rejected as an overlap",
    parseBellScheduleCsv(
      [
        "schedule_name,block_name,block_type,start_time,end_time",
        "Regular Day,Period 1,class,08:00,08:50",
        "Regular Day,Period 2,class,08:00,08:45",
      ].join("\n"),
    ).ok === false,
  );

  console.log("  33. No instructional/enrichment block");
  check(
    "33: a schedule with no student-facing block is rejected",
    parseBellScheduleCsv(
      [
        "schedule_name,block_name,block_type,start_time,end_time",
        "Regular Day,Passing,passing,08:00,08:05",
        "Regular Day,Lunch,lunch,08:05,08:35",
        "Regular Day,Prep,prep,08:35,09:25",
      ].join("\n"),
    ).ok === false,
  );

  console.log("  34. Malformed/unclosed quote");
  {
    const result = parseBellScheduleCsv(
      ['schedule_name,block_name,block_type,start_time,end_time', '"Regular Day,Period 1,class,08:00,08:50'].join("\n"),
    );
    check("34a: an unclosed quote is rejected", result.ok === false);
    check("34b: message is generic, not overclaiming a specific quote defect", firstMessage(result).toLowerCase().includes("malformed"));
  }

  console.log("  35. Illegal quote placement (misplaced quote, not merely unclosed)");
  {
    const result = parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", 'Reg"ular Day,Period 1,class,08:00,08:50'].join("\n"),
    );
    check("35a: a stray mid-field quote is rejected", result.ok === false);
    check(
      "35b: uses the same generic malformed-quoting message, not a false 'unclosed quote' claim",
      firstMessage(result).toLowerCase().includes("malformed"),
    );
  }
}

console.log("\n36-39. Same-name conflict detection");
{
  const existingSchedules: BellSchedule[] = [
    { id: "s1", name: "Regular Day", ownerType: "teacher", isDefault: false, timeZone: "America/Detroit", blocks: [] },
  ];

  check("36: exact-name conflict is detected", findScheduleNameConflict("Regular Day", existingSchedules)?.id === "s1");
  check("37: case-insensitive conflict is detected", findScheduleNameConflict("regular day", existingSchedules)?.id === "s1");
  check(
    "38: whitespace-insensitive conflict is detected",
    findScheduleNameConflict("  Regular Day  ", existingSchedules)?.id === "s1",
  );
  check(
    "39: a renamed schedule no longer conflicts",
    findScheduleNameConflict("Regular Day (Imported)", existingSchedules) === null,
  );
}

console.log("\n40-44. Payload builder");
{
  const blocks: ParsedBellScheduleBlock[] = [
    { label: "Period 1", kind: "instructional", startTime: "08:00", endTime: "08:50" },
    { label: "Period 2", kind: "instructional", startTime: "08:55", endTime: "09:45" },
  ];

  const payload = buildBellScheduleImportPayload("schedule-abc123", ["block-aaa", "block-bbb"], "Regular Day", blocks);
  check("40: caller-provided schedule id is preserved", payload.id === "schedule-abc123");
  check(
    "41: caller-provided block ids are preserved in order",
    payload.blocks[0].id === "block-aaa" && payload.blocks[1].id === "block-bbb",
  );
  check(
    "42: block ids are exactly the caller-generated values, never derived from CSV label text",
    payload.blocks[0].id === "block-aaa" && !payload.blocks[0].id.toLowerCase().includes("period"),
  );

  let tooFewThrew = false;
  try {
    buildBellScheduleImportPayload("schedule-abc123", ["block-aaa"], "Regular Day", blocks);
  } catch {
    tooFewThrew = true;
  }
  check("43: blockIds.length < blocks.length throws", tooFewThrew);

  let tooManyThrew = false;
  try {
    buildBellScheduleImportPayload("schedule-abc123", ["block-aaa", "block-bbb", "block-ccc"], "Regular Day", blocks);
  } catch {
    tooManyThrew = true;
  }
  check("44: blockIds.length > blocks.length throws", tooManyThrew);
}

console.log("\n45-49. Row-width (exact cell count) enforcement");
{
  console.log("  45. Extra sixth cell is rejected");
  check(
    "45: a row with a 6th cell is rejected",
    parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,class,08:00,08:50,EXTRA"].join("\n"),
    ).ok === false,
  );

  console.log("  46. Trailing blank sixth cell is rejected");
  check(
    "46: a row with a trailing delimiter producing a blank 6th cell is rejected",
    parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,class,08:00,08:50,"].join("\n"),
    ).ok === false,
  );

  console.log("  47. Missing fifth cell is rejected");
  check(
    "47: a row with only 4 cells is rejected",
    parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1,class,08:00"].join("\n"),
    ).ok === false,
  );

  console.log("  48. Unquoted comma creating six cells is rejected");
  check(
    "48: an unquoted comma inside what was meant to be one field is rejected",
    parseBellScheduleCsv(
      ["schedule_name,block_name,block_type,start_time,end_time", "Regular Day,Period 1, East,class,08:00,08:50"].join("\n"),
    ).ok === false,
  );

  console.log("  49. A quoted field containing a comma still parses as exactly 5 cells");
  {
    const result = parseBellScheduleCsv(
      ['schedule_name,block_name,block_type,start_time,end_time', 'Regular Day,"Period 1, East",class,08:00,08:50'].join("\n"),
    );
    check("49: the quoted-comma case remains valid, not rejected by the cell-count check", result.ok === true);
    check("49b: the comma-containing label is preserved intact", result.ok && result.blocks[0]?.label === "Period 1, East");
  }
}

console.log("\n50-55. BellScheduleImportPanel.tsx source invariants (no component-rendering harness exists - see verify-lesson-import.ts's scenario 18 for the same pattern)");
{
  const source = readFileSync(join(process.cwd(), "components/schedule/BellScheduleImportPanel.tsx"), "utf8");

  check("50: the panel uses the atomic RPC helper", source.includes("importBellSchedule"));
  check("51: the panel never calls actions.addBuiltInSchedule", !source.includes("addBuiltInSchedule"));
  check("52: the panel never dispatches ADD_SCHEDULE", !source.includes("ADD_SCHEDULE"));
  check("53: the panel never imports the removed legacy parseBellScheduleTable", !source.includes("parseBellScheduleTable"));
  check("54: the panel never imports the removed legacy buildScheduleBlocksFromRows", !source.includes("buildScheduleBlocksFromRows"));
  check(
    "55a: the panel calls window.location.reload() exactly once",
    (source.match(/window\.location\.reload\(\)/g) ?? []).length === 1,
  );
  check(
    "55b: reload() occurs only after the awaited importBellSchedule call resolves, inside its ok:true branch",
    /await importBellSchedule\(\{[\s\S]*?\}\);[\s\S]{0,40}if \(result\.ok\) \{[\s\S]{0,200}window\.location\.reload\(\);/.test(
      source,
    ),
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
