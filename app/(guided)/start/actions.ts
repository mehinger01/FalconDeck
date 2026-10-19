"use server";

import type { GuidedReference } from "@/components/guided/GuidedSetup";
import { resolveGuidedSetupContext } from "@/lib/auth/guidedSetupEntry";
import { fetchAppData } from "@/lib/data/supabaseDataRepository";
import { isUsableSharedSchedule } from "@/lib/schedule/isUsableSharedSchedule";
import { createSupabaseServerClient } from "@/lib/supabase/serverClient";

/**
 * Re-reads the school's schedules, courses and calendar for a guided-setup
 * page that has to recover from a conflict (a school schedule edited, or
 * schedule preferences changed, since the page loaded). Read-only, and only
 * for an account the entry rule still sends to guided setup - anything else
 * gets null and the page keeps what it has.
 */
export async function loadGuidedReference(): Promise<GuidedReference | null> {
  const context = await resolveGuidedSetupContext();
  if (context.entry !== "guided-setup") return null;
  const client = await createSupabaseServerClient();
  const data = await fetchAppData(client as unknown as Parameters<typeof fetchAppData>[0], {
    organizationId: context.membership.organizationId,
    membershipId: context.membership.membershipId,
  });
  return {
    schoolSchedules: data.schedules.filter(isUsableSharedSchedule),
    schoolCourses: data.courses,
    schoolCalendar: data.schoolCalendar,
    baseData: data,
  };
}
