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
 * route (/, /login, /demo/*, /present, /open-house/*, and the authenticated
 * (app) group). It never resolves cookies/auth and keeps every route's
 * default static-rendering eligibility intact. Authenticated repository
 * selection (CutoverAppDataProvider) is resolved one level down, inside
 * app/(app)/layout.tsx - the only route group that actually needs it - not
 * here. See that file's doc comment for the nested-provider design.
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
