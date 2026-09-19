import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppDataProvider } from "@/lib/store/AppDataProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Falcon Deck",
  description: "Classroom presentation and scheduling system for Ogemaw Heights High School.",
};

/**
 * Deliberately stays auth-unaware - this is the public/root shell for every
 * route (/, /login, /demo/*, /open-house/*, and both authenticated route
 * groups). It never resolves cookies/auth and keeps every route's default
 * static-rendering eligibility intact where nothing more specific overrides
 * it. Authenticated repository selection (CutoverAppDataProvider) is
 * resolved one level down, inside app/(app)/layout.tsx and
 * app/(presentation)/present/layout.tsx - the two route groups that
 * actually need it - not here. /present now lives under the latter and
 * requires authentication; /demo/present remains the public, unauthenticated
 * alternative. See those files' doc comments for the nested-provider design.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppDataProvider>{children}</AppDataProvider>
      </body>
    </html>
  );
}
