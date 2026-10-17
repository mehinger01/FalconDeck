import { redirect } from "next/navigation";
import { GuidedSetup } from "@/components/guided/GuidedSetup";
import { fetchAppData } from "@/lib/data/supabaseDataRepository";
import { resolveGuidedSetupContext } from "@/lib/auth/guidedSetupEntry";
import { isUsableSharedSchedule } from "@/lib/schedule/isUsableSharedSchedule";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";

/**
 * Guided setup, step 1 ("Your teaching day"). Only an account the entry
 * rule sends here - with the server-side switch on - ever renders it; every
 * other account (switch off, established, legacy, setup state unreadable)
 * goes back to /setup, which is today's flow unchanged.
 *
 * Reference data (the school's schedules and courses) is read here on the
 * server, read-only. Nothing on this page writes operational data.
 */
export default async function StartPage() {
  const context = await resolveGuidedSetupContext();
  if (context.entry !== "guided-setup") redirect("/setup");

  const { membership, setupState } = context;
  const client = await createSupabaseServerClient();
  const reference = await fetchAppData(client as unknown as Parameters<typeof fetchAppData>[0], {
    organizationId: membership.organizationId,
    membershipId: membership.membershipId,
  });

  return (
    <GuidedSetup
      organizationId={membership.organizationId}
      organizationName={membership.organizationName}
      setupState={setupState}
      schoolSchedules={reference.schedules.filter(isUsableSharedSchedule)}
      schoolCourses={reference.courses}
    />
  );
}
