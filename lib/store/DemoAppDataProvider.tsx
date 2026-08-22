"use client";

import { useState, type ReactNode } from "react";
import { DemoDataRepository } from "@/lib/data/demoModeRepository";
import { AppDataProvider } from "./AppDataProvider";

/**
 * Wraps the `/demo` route tree in a completely separate `AppDataContext`
 * from the real app - `useAppData()` always resolves to the *nearest*
 * provider, so every existing screen (WeekScreen, ScheduleSetupScreen,
 * MasterCalendarScreen, ResourceLibraryScreen, PresentScreen, ...) works
 * under `/demo` completely unmodified, reading and writing the isolated
 * `DemoDataRepository` instance instead of real AppData. The real
 * `AppDataProvider` at the root layout keeps running underneath,
 * untouched - Demo Mode is additive, never a replacement.
 */
export function DemoAppDataProvider({ children }: { children: ReactNode }) {
  const [repository] = useState(() => new DemoDataRepository());

  return (
    <AppDataProvider repository={repository} seedData={() => repository.getInitialSnapshot()}>
      {children}
    </AppDataProvider>
  );
}
