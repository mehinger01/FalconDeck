/**
 * Standalone verification for Bell Clock Synchronization (the
 * `bellOffsetSeconds` calibration layer): `clampBellOffsetSeconds`,
 * `applyBellOffset`, their composition with the real schedule engine and
 * the real DST-aware zoned-time conversion, the reducer's defensive clamp,
 * the load-time persistence normalization, and a static structural check
 * that Present Mode's clock wiring still matches the approved
 * single-subscription architecture.
 *
 * Not a test framework - just a script with assertions, run via `tsx`,
 * matching the existing scripts/verify-*.ts convention:
 *
 *   npx tsx scripts/verify-bell-offset.ts
 *
 * Run scripts/verify-usenow.ts separately afterward as its own step - the
 * useNow resume-behavior checks it covers are not duplicated here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyBellOffset,
  clampBellOffsetSeconds,
  BELL_OFFSET_MIN_SECONDS,
  BELL_OFFSET_MAX_SECONDS,
  getZonedNow,
} from "@/lib/schedule/time";
import { getLocalDateKey } from "@/lib/schedule/localDate";
import { getPresentationState } from "@/lib/schedule/getPresentationState";
import { getCurrentBlock } from "@/lib/schedule/getCurrentBlock";
import { DEMO_SCHEDULES, createDemoAppData } from "@/lib/data/demoData";
import { LocalStorageDataRepository } from "@/lib/data/localStorageRepository";
import { appDataReducer } from "@/lib/store/reducer";

let failures = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

// Fixed, unambiguous (both EDT, no DST edge) 2026 Monday - same fixture
// date convention as scripts/verify-schedule.ts.
const MONDAY = "2026-08-17";

function atLocalTime(isoDate: string, time: string): Date {
  // Accept either "HH:MM" (seconds default to :00) or "HH:MM:SS" for
  // the second-level precision the threshold-boundary tests need.
  const withSeconds = time.split(":").length === 3 ? time : `${time}:00`;
  return new Date(`${isoDate}T${withSeconds}-04:00`);
}

const schedule = DEMO_SCHEDULES.find((s) => s.id === "schedule-demo-standard")!;

// schedule-demo-standard Monday blocks (from lib/data/demoData.ts):
//   Period 2:        08:49-09:39  instructional
//   Passing Period:  09:39-09:44  passing
//   Enrichment:      09:48-10:08  enrichment
//   Period 4:        10:12-11:02  instructional

console.log("1. clampBellOffsetSeconds");
{
  check("10 -> 10", clampBellOffsetSeconds(10) === 10);
  check("10.7 -> 11", clampBellOffsetSeconds(10.7) === 11);
  check("500 -> 120", clampBellOffsetSeconds(500) === 120);
  check("-500 -> -120", clampBellOffsetSeconds(-500) === -120);
  check("NaN -> 0", clampBellOffsetSeconds(NaN) === 0);
  check("Infinity -> 0", clampBellOffsetSeconds(Infinity) === 0);
  check("-Infinity -> 0", clampBellOffsetSeconds(-Infinity) === 0);
  check("range constants are -120/+120", BELL_OFFSET_MIN_SECONDS === -120 && BELL_OFFSET_MAX_SECONDS === 120);
}

console.log("\n2. applyBellOffset");
{
  const base = atLocalTime(MONDAY, "09:00");
  check("offset 0 preserves the same instant", applyBellOffset(base, 0).getTime() === base.getTime());
  check("+10 shifts exactly +10,000ms", applyBellOffset(base, 10).getTime() - base.getTime() === 10_000);
  check("-10 shifts exactly -10,000ms", applyBellOffset(base, -10).getTime() - base.getTime() === -10_000);
  check(
    "out-of-range positive values are clamped before application (500 behaves like 120)",
    applyBellOffset(base, 500).getTime() === applyBellOffset(base, 120).getTime(),
  );
  check(
    "out-of-range negative values are clamped before application (-500 behaves like -120)",
    applyBellOffset(base, -500).getTime() === applyBellOffset(base, -120).getTime(),
  );
}

console.log("\n3. Backward compatibility - schedule state");
{
  const now = atLocalTime(MONDAY, "09:15");
  const raw = getPresentationState(schedule, now);
  const withZeroOffset = getPresentationState(schedule, applyBellOffset(now, 0));
  check(
    "offset 0 produces the same getPresentationState result as raw time",
    JSON.stringify(raw) === JSON.stringify(withZeroOffset),
  );
}

async function withFakeLocalStorage(run: (fakeStore: Map<string, string>) => Promise<void>) {
  const fakeStore = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => fakeStore.get(key) ?? null,
      setItem: (key: string, value: string) => {
        fakeStore.set(key, value);
      },
      removeItem: (key: string) => {
        fakeStore.delete(key);
      },
    },
  };
  try {
    await run(fakeStore);
  } finally {
    delete (globalThis as Record<string, unknown>).window;
  }
}

async function verifyPersistence() {
  console.log("\n3b. Persistence: legacy missing field and out-of-range stored values");

  await withFakeLocalStorage(async (fakeStore) => {
    const legacyAppData = createDemoAppData();
    const { bellOffsetSeconds: _drop, ...legacySettingsWithoutOffset } = legacyAppData.classroomExperienceSettings;
    fakeStore.set(
      "falcon-deck:app-data:v1",
      JSON.stringify({ ...legacyAppData, classroomExperienceSettings: legacySettingsWithoutOffset }),
    );
    const loaded = await new LocalStorageDataRepository().load();
    check(
      "legacy payload with no bellOffsetSeconds key loads as 0",
      loaded.classroomExperienceSettings.bellOffsetSeconds === 0,
    );
  });

  const storeAndLoad = async (value: unknown) => {
    let result: number | undefined;
    await withFakeLocalStorage(async (fakeStore) => {
      const base = createDemoAppData();
      fakeStore.set(
        "falcon-deck:app-data:v1",
        JSON.stringify({
          ...base,
          classroomExperienceSettings: { ...base.classroomExperienceSettings, bellOffsetSeconds: value },
        }),
      );
      const loaded = await new LocalStorageDataRepository().load();
      result = loaded.classroomExperienceSettings.bellOffsetSeconds;
    });
    return result;
  };

  check("persisted 500 loads clamped to 120", (await storeAndLoad(500)) === 120);
  check("persisted -500 loads clamped to -120", (await storeAndLoad(-500)) === -120);
  check("persisted null loads normalized to 0", (await storeAndLoad(null)) === 0);
  check("persisted malformed string '120abc' loads normalized to 0", (await storeAndLoad("120abc")) === 0);
}

console.log("\n4. Positive and negative offsets against the real schedule fixture");
{
  const now = atLocalTime(MONDAY, "09:00");
  const plus10 = getPresentationState(schedule, applyBellOffset(now, 10));
  const minus10 = getPresentationState(schedule, applyBellOffset(now, -10));
  check("+10 still resolves to Period 2 (student-facing)", plus10.mode === "student-facing");
  check("-10 still resolves to Period 2 (student-facing)", minus10.mode === "student-facing");
  if (plus10.mode === "student-facing" && minus10.mode === "student-facing") {
    check(
      "+10 and -10 both report the same block, differing remainingSeconds by 20s",
      plus10.block.blockId === minus10.block.blockId && minus10.remainingSeconds - plus10.remainingSeconds === 20,
    );
  }
}

console.log("\n5. 5-minute countdown threshold crossing via offset alone");
{
  const baseA = atLocalTime(MONDAY, "09:33:55");
  const rawA = getPresentationState(schedule, baseA);
  const offsetA = getPresentationState(schedule, applyBellOffset(baseA, 10));
  check("base A (305s remaining) shows no countdown yet", rawA.mode === "student-facing" && rawA.showCountdown === false);
  check(
    "+10 alone crosses the 5-minute threshold into showing the countdown",
    offsetA.mode === "student-facing" && offsetA.showCountdown === true,
  );

  const baseB = atLocalTime(MONDAY, "09:34:05");
  const rawB = getPresentationState(schedule, baseB);
  const offsetB = getPresentationState(schedule, applyBellOffset(baseB, -10));
  check("base B (295s remaining) shows the countdown", rawB.mode === "student-facing" && rawB.showCountdown === true);
  check(
    "-10 alone crosses back outside the 5-minute threshold",
    offsetB.mode === "student-facing" && offsetB.showCountdown === false,
  );
}

console.log("\n6. Block-end transition via offset alone");
{
  const base = atLocalTime(MONDAY, "09:38:55");
  const raw = getPresentationState(schedule, applyBellOffset(base, 0));
  const offset = getPresentationState(schedule, applyBellOffset(base, 10));
  check("offset 0 stays in Period 2", raw.mode === "student-facing" && raw.block.label === "Period 2");
  check(
    "+10 alone moves state into the next block (Passing)",
    offset.mode === "transition" && offset.currentBlock?.kind === "passing",
  );
}

console.log("\n7. Passing-time transition via an in-range offset alone");
{
  const base = atLocalTime(MONDAY, "09:38:00");
  const raw = getCurrentBlock(schedule, base);
  const offsetBlock = getCurrentBlock(schedule, applyBellOffset(base, 100));
  check("raw time is still in Period 2", raw?.kind === "instructional");
  check("+100 alone lands inside the Passing block", offsetBlock?.kind === "passing");
}

console.log("\n8. Next-period transition consistency after offset");
{
  const base = atLocalTime(MONDAY, "09:40:00");
  const raw = getPresentationState(schedule, base);
  const offset = getPresentationState(schedule, applyBellOffset(base, 10));
  check(
    "raw and offset states are both transitions to the same next block",
    raw.mode === "transition" && offset.mode === "transition",
  );
  if (raw.mode === "transition" && offset.mode === "transition") {
    check(
      "nextStudentFacingBlock is Enrichment in both",
      raw.nextStudentFacingBlock?.blockId === "block-enrichment" &&
        offset.nextStudentFacingBlock?.blockId === "block-enrichment",
    );
    check(
      "secondsUntilNextStudentFacing shrinks by exactly the 10s offset",
      raw.secondsUntilNextStudentFacing !== null &&
        offset.secondsUntilNextStudentFacing !== null &&
        raw.secondsUntilNextStudentFacing - offset.secondsUntilNextStudentFacing === 10,
    );
  }
}

console.log("\n9. Midnight edge");
{
  const justAfterMidnight = atLocalTime("2026-08-18", "00:00:05");
  const beforeMidnightRollback = applyBellOffset(justAfterMidnight, -10);
  check(
    "a small negative offset just after local midnight resolves to the previous local date",
    getLocalDateKey(justAfterMidnight, schedule.timeZone) === "2026-08-18" &&
      getLocalDateKey(beforeMidnightRollback, schedule.timeZone) === "2026-08-17",
  );

  const justBeforeMidnight = atLocalTime("2026-08-17", "23:59:55");
  const afterMidnightRollforward = applyBellOffset(justBeforeMidnight, 10);
  check(
    "a small positive offset just before midnight resolves to the next local date",
    getLocalDateKey(justBeforeMidnight, schedule.timeZone) === "2026-08-17" &&
      getLocalDateKey(afterMidnightRollforward, schedule.timeZone) === "2026-08-18",
  );
}

console.log("\n10. DST composition (America/Detroit, 2026 - no new DST logic, just proving the existing composition)");
{
  const beforeSpringForward = new Date("2026-03-08T01:59:50-05:00");
  const afterSpringForwardOffset = applyBellOffset(beforeSpringForward, 15);
  const rawZoned = getZonedNow(beforeSpringForward, "America/Detroit");
  const offsetZoned = getZonedNow(afterSpringForwardOffset, "America/Detroit");
  check(
    "raw instant reads as 1:59:50 AM EST just before spring-forward",
    rawZoned.hour === 1 && rawZoned.minute === 59 && rawZoned.second === 50,
  );
  check(
    "+15s across the spring-forward gap reads as 3:00:05 AM EDT (real elapsed time correctly composed with the zone jump)",
    offsetZoned.hour === 3 && offsetZoned.minute === 0 && offsetZoned.second === 5,
  );

  const beforeFallBack = new Date("2026-11-01T01:59:50-04:00");
  const afterFallBackOffset = applyBellOffset(beforeFallBack, 15);
  const rawZonedFallBack = getZonedNow(beforeFallBack, "America/Detroit");
  const offsetZonedFallBack = getZonedNow(afterFallBackOffset, "America/Detroit");
  check(
    "raw instant reads as 1:59:50 AM EDT just before fall-back",
    rawZonedFallBack.hour === 1 && rawZonedFallBack.minute === 59 && rawZonedFallBack.second === 50,
  );
  check(
    "+15s across the fall-back gap reads as 1:00:05 AM EST (wall clock appears to go backward, correctly)",
    offsetZonedFallBack.hour === 1 && offsetZonedFallBack.minute === 0 && offsetZonedFallBack.second === 5,
  );
}

console.log("\n11. Reducer clamp");
{
  const base = createDemoAppData();
  const tooHigh = appDataReducer(base, {
    type: "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS",
    patch: { bellOffsetSeconds: 500 },
  });
  const tooLow = appDataReducer(base, {
    type: "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS",
    patch: { bellOffsetSeconds: -500 },
  });
  const nonFinite = appDataReducer(base, {
    type: "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS",
    patch: { bellOffsetSeconds: NaN },
  });
  const untouchedField = appDataReducer(base, {
    type: "UPDATE_CLASSROOM_EXPERIENCE_SETTINGS",
    patch: { finalFiveMessage: "unchanged offset check" },
  });
  check("dispatching 500 clamps the stored value to 120", tooHigh.classroomExperienceSettings.bellOffsetSeconds === 120);
  check("dispatching -500 clamps the stored value to -120", tooLow.classroomExperienceSettings.bellOffsetSeconds === -120);
  check("dispatching NaN clamps the stored value to 0", nonFinite.classroomExperienceSettings.bellOffsetSeconds === 0);
  check(
    "a patch that doesn't touch bellOffsetSeconds leaves it unchanged",
    untouchedField.classroomExperienceSettings.bellOffsetSeconds === base.classroomExperienceSettings.bellOffsetSeconds,
  );
}

console.log("\n12. Settings/runtime wiring (static source inspection, not executed)");
{
  const repoRoot = process.cwd();
  const read = (relPath: string) => readFileSync(join(repoRoot, relPath), "utf8");
  const countOccurrences = (source: string, needle: string) => {
    let count = 0;
    let idx = 0;
    while (true) {
      idx = source.indexOf(needle, idx);
      if (idx === -1) break;
      count += 1;
      idx += needle.length;
    }
    return count;
  };

  const bellClockSection = read("components/settings/BellClockOffsetSection.tsx");
  check(
    "BellClockOffsetSection has exactly one useNow(...) call site (the doc comment's prose mention of `useNow(1000)` is deliberately excluded)",
    countOccurrences(bellClockSection, "= useNow(") === 1,
  );
  check(
    "Falcon Deck Time is derived from that same computerTime via applyBellOffset",
    /falconDeckTime\s*=\s*computerTime\s*\?\s*applyBellOffset\(computerTime,\s*bellOffsetSeconds\)/.test(bellClockSection),
  );

  const liveScreen = read("components/present/LivePresentScreen.tsx");
  check(
    "LivePresentScreen contains no direct useNow(...) or useEffectiveNow(...) call",
    countOccurrences(liveScreen, "useNow(") === 0 && countOccurrences(liveScreen, "useEffectiveNow(") === 0,
  );

  const cleanScreen = read("components/present/tools/CleanScreenOverlay.tsx");
  check(
    "CleanScreenOverlay contains no direct useNow(...) or useEffectiveNow(...) call",
    countOccurrences(cleanScreen, "useNow(") === 0 && countOccurrences(cleanScreen, "useEffectiveNow(") === 0,
  );

  const presentScreen = read("components/present/PresentScreen.tsx");
  check("PresentScreen owns exactly one useEffectiveNow(...) subscription", countOccurrences(presentScreen, "useEffectiveNow(") === 1);
  check(
    "PresentScreen passes the same effectiveNow value to both LivePresentScreen and CleanScreenOverlay",
    countOccurrences(presentScreen, "effectiveNow={liveEffectiveNow}") === 2,
  );

  const demoSimulator = read("components/demo/DemoPresentSimulator.tsx");
  check(
    "Demo Mode passes the same simulatedNow to both LivePresentScreen and CleanScreenOverlay",
    countOccurrences(demoSimulator, "effectiveNow={simulatedNow}") === 2,
  );
  check(
    "Demo Mode never references bellOffsetSeconds or useEffectiveNow",
    !demoSimulator.includes("bellOffsetSeconds") && !demoSimulator.includes("useEffectiveNow"),
  );

  const previewScreen = read("components/present/PreviewPresentScreen.tsx");
  check(
    "Preview Mode never references bellOffsetSeconds, useEffectiveNow, or useNow",
    !previewScreen.includes("bellOffsetSeconds") &&
      !previewScreen.includes("useEffectiveNow") &&
      !previewScreen.includes("useNow("),
  );

  const repository = read("lib/data/localStorageRepository.ts");
  check(
    "localStorageRepository normalizes bellOffsetSeconds at load time via clampBellOffsetSeconds",
    /bellOffsetSeconds:\s*clampBellOffsetSeconds\(/.test(repository),
  );
}

verifyPersistence().then(() => {
  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
});
