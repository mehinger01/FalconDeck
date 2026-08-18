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
