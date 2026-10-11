import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Inlined into the client bundle at build time so FalconErrorBoundary's
  // diagnostic report (lib/diagnostics/errorReport.ts) can name which
  // deploy a report came from - `VERCEL_GIT_COMMIT_SHA` is a Vercel system
  // env var, only ever available server-side/at build time, never set
  // locally (`next dev` falls back to "local").
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA
      ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
      : "local",
  },
};

export default nextConfig;
