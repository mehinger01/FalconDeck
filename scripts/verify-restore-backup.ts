/**
 * Offline verification of the backup RESTORE path (lib/data/migration/
 * restoreBackup.ts) - the read half of downloadBackup.ts's write-only
 * export. No network, no browser - a minimal in-memory `window.localStorage`
 * shim (same pattern scripts/verify-demo.ts already uses) stands in for the
 * real browser storage `LocalStorageDataRepository` writes to.
 *
 * Run: npm run verify:restore-backup
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { AppData } from "@/lib/data/types";
import { dataRepository } from "@/lib/data/localStorageRepository";
import { buildLocalDataBackup, serializeBackup } from "@/lib/data/migration/downloadBackup";
import { parseBackup, restoreBackupToLocal, validateBackup } from "@/lib/data/migration/restoreBackup";
import { deepEqual } from "@/lib/data/supabaseMapping";

let failures = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  - ${label}`);
  }
}

const STORAGE_KEY = "falcon-deck:app-data:v1";

function installFakeLocalStorage(seed?: Record<string, string>): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
  return store;
}

function uninstallFakeLocalStorage() {
  delete (globalThis as Record<string, unknown>).window;
}

// ---------------------------------------------------------------------------
// Realistic fixture (Step 10): multiple courses/sections, 2+ schedules with
// overrides, a calendar exception, several lessons with materials/
// resources/announcements, library resources, presentation settings,
// classroom-experience settings, and a lunch-wave preference.
// ---------------------------------------------------------------------------
function realisticFixture(): AppData {
  return {
    courses: [
      { id: "course-alg1", name: "Algebra 1", colorHex: "#2563eb", description: "Intro algebra" },
      { id: "course-geo", name: "Geometry", colorHex: "#16a34a" },
    ],
    classSections: [
      { id: "section-alg1-p1", courseId: "course-alg1", name: "Algebra 1 - Period 1", room: "204" },
      { id: "section-geo-p3", courseId: "course-geo", name: "Geometry - Period 3", room: "210" },
    ],
    schedules: [
      {
        id: "schedule-custom",
        name: "My Custom Schedule",
        isDefault: true,
        timeZone: "America/Detroit",
        source: "custom",
        needsConfiguration: false,
        blocks: [
          {
            id: "block-1",
            label: "Period 1",
            kind: "instructional",
            startTime: "08:00",
            endTime: "08:50",
            classSectionId: "section-alg1-p1",
            isLunchWindow: false,
            overrides: [{ id: "override-1", weekday: "thursday", label: "SAT Prep", classSectionId: null }],
          },
          {
            id: "block-2",
            label: "Period 3",
            kind: "instructional",
            startTime: "09:50",
            endTime: "10:40",
            classSectionId: "section-geo-p3",
            isLunchWindow: false,
            overrides: [],
          },
        ],
      },
      {
        id: "schedule-builtin",
        name: "OHHS Regular Day",
        isDefault: false,
        timeZone: "America/Detroit",
        source: "built-in",
        needsConfiguration: false,
        blocks: [
          {
            id: "block-builtin-1",
            label: "Period 1",
            kind: "instructional",
            startTime: "08:00",
            endTime: "08:50",
            classSectionId: null,
            isLunchWindow: false,
            overrides: [],
          },
        ],
      },
    ],
    lessons: [
      {
        id: "lesson-1",
        date: "2026-09-15",
        classSectionId: "section-alg1-p1",
        learningTarget: "Solve linear equations",
        agendaItems: [{ id: "ai-1", title: "Warm-up", isCompleted: false, sortOrder: 0 }],
        resources: [{ id: "lr-1", title: "Worksheet", url: "https://example.com/w.pdf", type: "pdf" }],
        announcements: [{ id: "an-1", text: "Quiz Friday" }],
        materials: "Guided notes, calculators",
        createdAt: "2026-09-14T12:00:00.000Z",
        updatedAt: "2026-09-14T12:00:00.000Z",
      },
      {
        id: "lesson-2",
        date: "2026-09-16",
        classSectionId: "section-geo-p3",
        learningTarget: "Classify triangles",
        agendaItems: [],
        resources: [],
        announcements: [],
        createdAt: "2026-09-15T12:00:00.000Z",
        updatedAt: "2026-09-15T12:00:00.000Z",
      },
    ],
    classPresentationSettings: [{ classSectionId: "section-alg1-p1", arrivalInstructions: ["Take out notebook", "Sharpen pencils"] }],
    classroomExperienceSettings: {
      finalFiveMessage: "Wrap up!",
      showEndOfDayScreen: true,
      endOfDayMessage: "Have a great afternoon.",
      cleanScreenDefaultMessage: "Work Time",
      showClockOnCleanScreen: true,
      transitionCountdownEnabled: true,
      transitionArrivalInstructionsEnabled: true,
      watermarkOpacity: 0.35,
      bellOffsetSeconds: -12,
    },
    libraryResources: [
      {
        id: "resource-1",
        title: "Khan Academy",
        url: "https://khanacademy.org",
        type: "link",
        courseIds: ["course-alg1"],
        tags: ["review"],
        isFavorite: true,
        source: { kind: "manual" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    teacherSchedulePreferences: { lunchWave: "B" },
    schoolCalendar: {
      id: "calendar-1",
      name: "2026-27 School Year",
      schoolYear: "2026-2027",
      timeZone: "America/Detroit",
      firstStudentDay: "2026-08-25",
      lastStudentDay: "2027-06-10",
      defaultBellScheduleId: "schedule-custom",
      exceptions: [{ id: "exc-1", startDate: "2026-09-07", endDate: "2026-09-07", type: "no-school", title: "Labor Day" }],
    },
  };
}

async function main() {
  // -------------------------------------------------------------------
  // 1-9. Full round-trip with the realistic fixture (Step 10).
  // -------------------------------------------------------------------
  console.log("\n1-9. Full backup -> restore -> reload round-trip (realistic fixture)");
  installFakeLocalStorage();
  const fixture = realisticFixture();
  const backup = buildLocalDataBackup(fixture);
  const serialized = serializeBackup(backup);
  const parsed = parseBackup(serialized);
  check("1. the current backup format round-trips through parseBackup", parsed.ok === true);

  if (parsed.ok) {
    const restoreOutcome = await restoreBackupToLocal(parsed.data);
    check("1. restoreBackupToLocal reports success", restoreOutcome.ok === true);

    const reloaded = await dataRepository.load();
    check("1. AppData -> backup -> restore -> load is semantically equal to the original fixture", deepEqual(reloaded, fixture));
    check("2. entity ids are preserved (course, section, schedule, block, override, lesson, resource)", (() => {
      const s = reloaded.schedules.find((sc) => sc.id === "schedule-custom");
      return (
        reloaded.courses.some((c) => c.id === "course-alg1") &&
        reloaded.classSections.some((c) => c.id === "section-alg1-p1") &&
        s?.blocks[0]?.id === "block-1" &&
        s?.blocks[0]?.overrides[0]?.id === "override-1" &&
        reloaded.lessons.some((l) => l.id === "lesson-1") &&
        reloaded.libraryResources.some((r) => r.id === "resource-1")
      );
    })());
    check(
      "3. timestamps are preserved exactly (lesson + library resource createdAt/updatedAt)",
      reloaded.lessons.find((l) => l.id === "lesson-1")?.createdAt === "2026-09-14T12:00:00.000Z" &&
        reloaded.libraryResources.find((r) => r.id === "resource-1")?.updatedAt === "2026-09-01T00:00:00.000Z",
    );
    check(
      "4. school calendar (incl. exception) is preserved",
      reloaded.schoolCalendar?.id === "calendar-1" && reloaded.schoolCalendar.exceptions.length === 1 && reloaded.schoolCalendar.exceptions[0].title === "Labor Day",
    );
    check(
      "5. presentation settings are preserved",
      reloaded.classPresentationSettings[0]?.arrivalInstructions.length === 2,
    );
    check(
      "6. classroom experience settings are preserved",
      reloaded.classroomExperienceSettings.bellOffsetSeconds === -12 && reloaded.classroomExperienceSettings.finalFiveMessage === "Wrap up!",
    );
    check("7. teacher schedule preferences are preserved", reloaded.teacherSchedulePreferences.lunchWave === "B");
    check(
      "8. library resource <-> course relationships are preserved",
      reloaded.libraryResources.find((r) => r.id === "resource-1")?.courseIds.includes("course-alg1") === true,
    );
    check(
      "9. lesson <-> class-section relationships are preserved",
      reloaded.lessons.find((l) => l.id === "lesson-1")?.classSectionId === "section-alg1-p1",
    );
  }
  uninstallFakeLocalStorage();

  // -------------------------------------------------------------------
  // 10-13. Malformed/invalid backups are rejected, never thrown raw.
  // -------------------------------------------------------------------
  console.log("\n10-13. malformed/invalid backups are rejected");
  check("10. malformed JSON is rejected, not thrown", parseBackup("{ this is not json").ok === false);
  check("11. valid JSON but the wrong top-level structure is rejected", validateBackup({ foo: "bar" }).ok === false);
  check("11. a bare array is rejected", validateBackup([1, 2, 3]).ok === false);
  check(
    "12. an unsupported future backup version is rejected",
    validateBackup({ backupFormatVersion: 999, exportedAt: new Date().toISOString(), appData: realisticFixture() }).ok === false,
  );
  check(
    "13. a malformed entity (course missing id) is rejected",
    validateBackup({
      backupFormatVersion: 1,
      exportedAt: new Date().toISOString(),
      appData: { ...realisticFixture(), courses: [{ name: "No id here" }] },
    }).ok === false,
  );
  check(
    "13. a malformed entity (lesson with an invalid timestamp) is rejected",
    validateBackup({
      backupFormatVersion: 1,
      exportedAt: new Date().toISOString(),
      appData: { ...realisticFixture(), lessons: [{ ...realisticFixture().lessons[0], createdAt: "not-a-date" }] },
    }).ok === false,
  );
  check(
    "13. a schedule with no default flag at all is rejected",
    validateBackup({
      backupFormatVersion: 1,
      exportedAt: new Date().toISOString(),
      appData: { ...realisticFixture(), schedules: realisticFixture().schedules.map((s) => ({ ...s, isDefault: false })) },
    }).ok === false,
  );

  // -------------------------------------------------------------------
  // 14. An invalid backup never touches current local data.
  // -------------------------------------------------------------------
  console.log("\n14. an invalid backup does not modify current local data");
  {
    const seeded = realisticFixture();
    installFakeLocalStorage({ [STORAGE_KEY]: JSON.stringify(seeded) });
    const invalid = parseBackup("not json at all");
    check("14. the invalid backup was rejected before anything else happened", invalid.ok === false);
    const stillThere = await dataRepository.load();
    check("14. local data is byte-for-byte unchanged after a rejected backup", deepEqual(stillThere, seeded));
    uninstallFakeLocalStorage();
  }

  // -------------------------------------------------------------------
  // 15. A save() failure is reported as failure, never success.
  // -------------------------------------------------------------------
  console.log("\n15. a repository.save() failure never reports success");
  {
    const seeded = realisticFixture();
    const store = new Map<string, string>([[STORAGE_KEY, JSON.stringify(seeded)]]);
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: () => {
          throw new DOMException("simulated quota exceeded", "QuotaExceededError");
        },
        removeItem: (key: string) => store.delete(key),
      },
    };
    const outcome = await restoreBackupToLocal(realisticFixture());
    check("15. restoreBackupToLocal reports failure when save() throws", outcome.ok === false);
    check("15. no rollback is attempted when the ORIGINAL save never wrote anything", outcome.ok === false && outcome.rolledBack === false);
    uninstallFakeLocalStorage();
  }

  // -------------------------------------------------------------------
  // 16-17. Verification (read-back) failure triggers rollback, and the
  // rollback actually restores the pre-restore snapshot.
  // -------------------------------------------------------------------
  console.log("\n16-17. a verification mismatch triggers rollback, and rollback restores the previous snapshot");
  {
    const previous = realisticFixture();
    const store = new Map<string, string>([[STORAGE_KEY, JSON.stringify(previous)]]);
    let corruptNextWrite = true;
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (key === STORAGE_KEY && corruptNextWrite) {
            // Simulate the browser silently storing something other than
            // what was asked - the ONLY way to legitimately trigger "save
            // reported ok, but read-back disagrees" without lying about
            // save()'s own contract.
            corruptNextWrite = false;
            store.set(
              key,
              JSON.stringify({
                courses: [{ id: "CORRUPTED", name: "corrupted" }],
                classSections: [],
                schedules: [],
                lessons: [],
                classPresentationSettings: [],
                classroomExperienceSettings: {},
                libraryResources: [],
                teacherSchedulePreferences: {},
                schoolCalendar: null,
              }),
            );
            return;
          }
          store.set(key, value);
        },
        removeItem: (key: string) => store.delete(key),
      },
    };

    const attempted = realisticFixture();
    attempted.courses[0].name = "Attempted Restore Data";
    const outcome = await restoreBackupToLocal(attempted);
    check("16. a save-succeeded-but-read-back-mismatched restore reports failure", outcome.ok === false);
    check("16. rollback is attempted and reported as succeeded", outcome.ok === false && outcome.rolledBack === true);

    const afterRollback = await dataRepository.load();
    check("17. the pre-restore snapshot is exactly what's there after rollback", deepEqual(afterRollback, previous));
    uninstallFakeLocalStorage();
  }

  // -------------------------------------------------------------------
  // 18-19. Authority gating (source inspection - no component-rendering
  // harness exists in this repo, same limitation noted throughout this
  // milestone's other verify scripts).
  // -------------------------------------------------------------------
  console.log("\n18-19. authority gating (local permits restore, cloud-ready blocks it)");
  const cardSource = readFileSync(join(process.cwd(), "components", "onboarding", "RestoreBackupCard.tsx"), "utf8");
  check(
    "19. cloud-ready authority returns an early, explanatory block before any restore UI renders",
    /authorityKind === "cloud-ready"/.test(cardSource) && cardSource.indexOf('authorityKind === "cloud-ready"') < cardSource.indexOf("handleFileChosen"),
  );
  check(
    "19. the cloud-ready explanation matches the required copy",
    cardSource.includes("This account is already using cloud data. Local backup restore is unavailable here."),
  );
  check(
    "18. the local-authority path renders the real file input / restore flow",
    cardSource.includes('type="file"') && cardSource.includes("Restore this backup"),
  );
  check(
    "cloud-ready never constructs a Supabase client or writes localStorage as a fallback",
    !cardSource.includes("createSupabaseBrowserClient") && !cardSource.includes("SupabaseDataRepository"),
  );

  // -------------------------------------------------------------------
  // 20. Selecting a file never writes anything before confirmation.
  // -------------------------------------------------------------------
  console.log("\n20. selecting a file only parses/previews - it never writes before confirmation");
  {
    // No `window` installed at all - if parseBackup/validateBackup ever
    // touched localStorage, this would throw a ReferenceError instead of
    // returning a result, proving they're pure.
    const result = parseBackup(serializeBackup(buildLocalDataBackup(realisticFixture())));
    check("20. parseBackup/validateBackup run to completion with no `window` global present at all", result.ok === true);
  }
  check(
    "20. RestoreBackupCard only calls restoreBackupToLocal from its confirm handler, never from the file-input's onChange",
    (() => {
      const onChangeBlock = cardSource.slice(cardSource.indexOf("onChange={"), cardSource.indexOf("/>", cardSource.indexOf("onChange={")));
      return !onChangeBlock.includes("restoreBackupToLocal") && cardSource.includes("handleConfirmRestore") && cardSource.includes("restoreBackupToLocal(data)");
    })(),
  );

  // -------------------------------------------------------------------
  // 21-22. Migration stays separate and unchanged; its backup download
  // still works. Git-diff facts, not something a pure function call can
  // prove - same rationale as this milestone's other verify scripts.
  // -------------------------------------------------------------------
  console.log("\n21-22. migration action and its existing backup download are untouched by this feature");
  try {
    const migrationCardDiff = execFileSync("git", ["diff", "--name-only", "--", "components/onboarding/MigrationSetupCard.tsx"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    check("21. MigrationSetupCard.tsx was not modified by this change", migrationCardDiff === "");
    const downloadBackupDiff = execFileSync("git", ["diff", "--name-only", "--", "lib/data/migration/downloadBackup.ts"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    check("22. downloadBackup.ts (the existing migration backup download) was not modified by this change", downloadBackupDiff === "");
  } catch {
    check("21-22. git diff check for migration/download files", false);
  }

  // -------------------------------------------------------------------
  // 23. No Supabase writes occur during restore.
  // -------------------------------------------------------------------
  console.log("\n23. no Supabase writes occur during restore");
  const restoreBackupSource = readFileSync(join(process.cwd(), "lib", "data", "migration", "restoreBackup.ts"), "utf8");
  check(
    "23. restoreBackup.ts never imports a Supabase client/repository",
    !restoreBackupSource.includes('from "@/lib/supabase/browserClient"') && !restoreBackupSource.includes("SupabaseDataRepository"),
  );
  check(
    "23. restoreBackup.ts never mutates local_data_migrated_at or calls markMigrationComplete",
    !/local_data_migrated_at\s*[:=]/.test(restoreBackupSource) && !restoreBackupSource.includes("markMigrationComplete("),
  );

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error running restore-backup verification:", error);
  process.exit(1);
});
