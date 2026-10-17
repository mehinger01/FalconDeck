import { redirect } from "next/navigation";
import { GuidedSetup } from "@/components/guided/GuidedSetup";
import { resolveGuidedSetupContext } from "@/lib/auth/guidedSetupEntry";
import { fetchAppData } from "@/lib/data/supabaseDataRepository";
import { isUsableSharedSchedule } from "@/lib/schedule/isUsableSharedSchedule";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";
import { loadGuidedReference } from "./actions";

/**
 * Guided setup: "Your teaching day", "Your first lesson", "Review and
 * start". Only an account the entry rule sends here - with the server-side
 * switch on - ever renders it; every other account (switch off,
 * established, legacy, setup state unreadable, setup completed) goes back
 * to /setup, which is today's flow unchanged.
 *
 * Reference data (the school's schedules and courses, and the teacher's
 * readable data the classroom preview is projected onto) is read here on
 * the server, read-only. Nothing on this page writes operational data; the
 * only write that does is complete_setup, from the review step.
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
      schoolCalendar={reference.schoolCalendar}
      baseData={reference}
      reloadReference={loadGuidedReference}
    />
  );
}
