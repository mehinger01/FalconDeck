import type { ReactNode } from "react";
import { DemoAppDataProvider } from "@/lib/store/DemoAppDataProvider";
import { DemoShell } from "@/components/demo/DemoShell";

/**
 * Everything under /demo runs against an isolated DemoAppDataProvider
 * (see that file) instead of the real app's AppDataProvider from the root
 * layout - useAppData() always resolves to the nearest provider, so every
 * screen reused below (WeekScreen, ScheduleSetupScreen,
 * MasterCalendarScreen, ResourceLibraryScreen, LivePresentScreen) works
 * here completely unmodified, reading/writing only disposable demo state.
 */
export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoAppDataProvider>
      <DemoShell>{children}</DemoShell>
    </DemoAppDataProvider>
  );
}
