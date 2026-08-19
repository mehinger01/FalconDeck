import { NavBar } from "@/components/layout/NavBar";
import type { ReactNode } from "react";

export default function AppSectionLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-falcon-cream-200 text-falcon-brown-900">
      <NavBar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
