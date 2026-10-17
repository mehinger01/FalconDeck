/**
 * Browser harness for scripts/verify-guided-setup-routing.ts: the real
 * AppDataProvider and ActiveScheduleGate, with next/navigation stubbed
 * (esbuild plugin in the script) so the pathname is chosen per case and
 * router.replace() is recorded instead of navigating. Reads its case from
 * window.__ROUTE and records into window.__routing.
 */
import { createRoot } from "react-dom/client";
import { baseAppData, readOnlyRepository } from "@/lib/onboarding/review";
import { ActiveScheduleGate } from "@/lib/store/ActiveScheduleGate";
import { AppDataProvider } from "@/lib/store/AppDataProvider";

interface RouteCase {
  path: string;
  enabled: boolean;
  guidedSetupDue?: boolean;
  activeBellScheduleId: string | null;
}

const route = (window as unknown as { __ROUTE: RouteCase }).__ROUTE;
const data = {
  ...baseAppData({ schedules: [], courses: [], calendar: null }),
  teacherSchedulePreferences: { lunchWave: "none" as const, activeBellScheduleId: route.activeBellScheduleId },
};
const repository = readOnlyRepository(data);

createRoot(document.getElementById("root")!).render(
  <AppDataProvider repository={repository} seedData={() => data}>
    {route.guidedSetupDue === undefined ? (
      <ActiveScheduleGate enabled={route.enabled}>
        <main id="page">the page at {route.path}</main>
      </ActiveScheduleGate>
    ) : (
      <ActiveScheduleGate enabled={route.enabled} guidedSetupDue={route.guidedSetupDue}>
        <main id="page">the page at {route.path}</main>
      </ActiveScheduleGate>
    )}
  </AppDataProvider>,
);
