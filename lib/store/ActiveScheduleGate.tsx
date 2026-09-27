"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { TeacherSchedulePreferences } from "@/types/teacherSchedule";
import { useAppData } from "./AppDataProvider";

/**
 * Stage F (join-existing-school initiative): the app's first hard
 * navigation gate. Before this, nothing ever blocked a teacher from
 * reaching an ordinary route with teacherSchedulePreferences.activeBellScheduleId
 * still null - see the Stage F design report's finding that (app)/layout.tsx
 * only ever gated on "authenticated + resolved organization," never on
 * app-data content.
 *
 * Deliberately keyed on the raw activeBellScheduleId, not
 * getOnboardingStatus().scheduleComplete - the gate's job is only "has the
 * teacher made an explicit choice," never "does that choice have blocks
 * configured yet" (a private schedule the teacher just activated but
 * hasn't filled in should not re-trigger this gate; BlockList/ValidationBanner
 * already surface that separately, on /schedule itself).
 *
 * Mounted as a child of AppDataProvider inside CutoverAppDataProvider.tsx -
 * both (app)/layout.tsx and (presentation)/present/layout.tsx get it for
 * free through that one shared mount point, using the exact same
 * useAppData() authority everything else in this tree already uses. No
 * independent Supabase fetch, no second authority path, no localStorage,
 * no persisted "onboarding step" - every decision here is read fresh from
 * `data` on every render.
 *
 * Enforcement is authority-aware, via the `enabled` prop CutoverAppDataProvider
 * passes in (authority.kind === "cloud-ready") - NOT rediscovered here. A
 * migration-pending "local"-authority account (a legacy_import membership
 * whose one-time migration hasn't completed yet) must never be redirected
 * by this gate: bare /setup has to stay reachable so MigrationSetupCard can
 * run, and that account's local activeBellScheduleId is not yet the
 * authoritative signal anything should gate on. Once that same account
 * transitions to cloud-ready (CutoverAppDataProvider's mountKey changes,
 * forcing a fresh mount), full enforcement applies immediately - see the
 * Stage F cutover audit finding this fixes.
 */
const EXEMPT_PATH_PREFIXES = ["/setup/schedule", "/schedule"];

/**
 * Exported as a plain, pure function (not just inlined in the component
 * below) specifically so it can be behaviorally tested directly - this
 * repo has no React/DOM rendering harness (no jsdom/@testing-library), so
 * routing logic that only existed inside a rendered component tree would
 * only ever be provable by source inspection. See
 * scripts/verify-onboarding-schedule-choice-stage-f.ts.
 */
export function isExemptPath(pathname: string): boolean {
  return EXEMPT_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * True when `pathname` must redirect to /setup/schedule given these
 * preferences - the gate's entire decision, as one pure function with zero
 * React/next/navigation dependency. `/setup/schedule` and `/schedule`
 * always return false here regardless of activeBellScheduleId, which is
 * what structurally rules out a redirect loop: the destination this
 * function ever redirects TO can never also be a pathname this same
 * function says must redirect AWAY from.
 *
 * Deliberately has no concept of "authority" at all - whether the gate is
 * enforced for the current authority kind is a separate concern (see
 * shouldEnforceGate below), kept out of this function so it stays a pure
 * statement of "what does this pathname/these preferences alone imply."
 */
export function shouldGateRedirect(
  pathname: string,
  teacherSchedulePreferences: Pick<TeacherSchedulePreferences, "activeBellScheduleId">,
): boolean {
  const hasActiveSchedule = teacherSchedulePreferences.activeBellScheduleId !== null;
  return !hasActiveSchedule && !isExemptPath(pathname);
}

/**
 * The gate's complete, authority-aware decision - what ActiveScheduleGate
 * actually computes. `enabled` comes from CutoverAppDataProvider
 * (authority.kind === "cloud-ready") - a migration-pending "local"-authority
 * account must never be redirected by this gate at all (bare /setup must
 * stay reachable so MigrationSetupCard can run), while a "cloud-ready"
 * account gets the full, unweakened gate, bare /setup included. Exported
 * (rather than left inline in the component) for the same reason
 * shouldGateRedirect/isExemptPath are - direct behavioral testing without a
 * React/DOM rendering harness.
 */
export function shouldEnforceGate(
  enabled: boolean,
  pathname: string,
  teacherSchedulePreferences: Pick<TeacherSchedulePreferences, "activeBellScheduleId">,
): boolean {
  return enabled && shouldGateRedirect(pathname, teacherSchedulePreferences);
}

export function ActiveScheduleGate({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { data } = useAppData();
  const pathname = usePathname();
  const router = useRouter();

  const mustRedirect = shouldEnforceGate(enabled, pathname, data.teacherSchedulePreferences);

  useEffect(() => {
    if (mustRedirect) router.replace("/setup/schedule");
  }, [mustRedirect, router]);

  // Never render the protected page while a redirect is pending - matches
  // (app)/layout.tsx's own "redirect above, nothing rendered below" shape
  // for the organization-resolution gate this one sits alongside.
  if (mustRedirect) return null;

  return <>{children}</>;
}
