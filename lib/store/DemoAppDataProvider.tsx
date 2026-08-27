"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DemoDataRepository } from "@/lib/data/demoModeRepository";
import { dataRepository } from "@/lib/data/localStorageRepository";
import type { AppData } from "@/lib/data/types";
import { AppDataProvider } from "./AppDataProvider";

function DemoProviderInner({ initialData, children }: { initialData: AppData; children: ReactNode }) {
  const [repository] = useState(() => new DemoDataRepository(initialData));

  return (
    <AppDataProvider repository={repository} seedData={() => repository.getInitialSnapshot()}>
      {children}
    </AppDataProvider>
  );
}

export function DemoAppDataProvider({ children }: { children: ReactNode }) {
  const [initialData, setInitialData] = useState<AppData | null>(null);

  useEffect(() => {
    let cancelled = false;
    dataRepository.load().then((loaded) => {
      if (!cancelled) setInitialData(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!initialData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-falcon-brown-950 text-falcon-cream-100">
        Loading Demo Mode…
      </div>
    );
  }

  return <DemoProviderInner initialData={initialData}>{children}</DemoProviderInner>;
}
