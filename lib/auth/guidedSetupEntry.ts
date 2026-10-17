import "server-only";
import { redirect } from "next/navigation";
import { resolveActiveOrganization, type ActiveMembership } from "@/lib/auth/dal";
import { deriveDataAuthorityState } from "@/lib/auth/dataAuthority";
import { SupabaseSetupRepository, type SetupRpcClient } from "@/lib/data/supabaseSetupRepository";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { guidedSetupEntry, isGuidedSetupEnabled } from "@/lib/onboarding/guidedSetupFlag";
import type { SetupState } from "@/lib/onboarding/setupRepository";

export type GuidedSetupContext =
  | { entry: "existing-app" }
  | {
      entry: "guided-setup";
      membership: ActiveMembership;
      /** Always "in-progress" or an eligible "not-started" here. */
      setupState: Extract<SetupState, { status: "in-progress" | "not-started" }>;
    };

/**
 * Where this request's signed-in teacher belongs, read on the server: the
 * guided flow only when the switch is on and the existing entry rule says
 * so. Anything unexpected - no resolved school, a legacy account, the setup
 * state unreadable - answers "existing-app".
 *
 * Skips the setup RPC entirely when the switch is off, so with guided setup
 * off a request does exactly what it did before.
 */
export async function resolveGuidedSetupContext(): Promise<GuidedSetupContext> {
  if (!isGuidedSetupEnabled()) return { entry: "existing-app" };
  const resolution = await resolveActiveOrganization();
  if (resolution.state !== "resolved") return { entry: "existing-app" };
  const authority = deriveDataAuthorityState(resolution);
  if (authority.kind !== "cloud-ready") return { entry: "existing-app" };

  const client = await createSupabaseServerClient();
  const repository = new SupabaseSetupRepository(client as unknown as SetupRpcClient, resolution.membership.organizationId);
  const result = await repository.getState();
  const setupState = result.ok ? result.value : null;
  if (guidedSetupEntry(true, authority, setupState) !== "guided-setup" || setupState === null || setupState.status === "completed") {
    return { entry: "existing-app" };
  }
  return { entry: "guided-setup", membership: resolution.membership, setupState };
}

/**
 * Sends a guided-setup account to /start from an app layout. It has to be
 * the layout, not a page: the layouts wrap every page in ActiveScheduleGate,
 * which renders nothing in place of the page for an account with no active
 * schedule (every guided account) and replaces the URL with
 * /setup/schedule - so a redirect thrown by the page (/setup's) never reaches
 * the browser, and a new account signing in would land on the old schedule
 * screen. A no-op while the switch is off.
 */
export async function redirectToGuidedSetupIfDue(): Promise<void> {
  if ((await resolveGuidedSetupContext()).entry === "guided-setup") redirect("/start");
}
